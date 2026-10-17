//! Durable job execution: push ops, pull manifests, stream blobs with
//! resume, and retry with exponential backoff + jitter.
//!
//! Transfer success criterion (spec §12): an op is "sent" only when its
//! receipt says Applied/Duplicate — bytes on the wire never count.

use crate::messages::*;
use crate::op::{OpOutcome, OpReceipt, SyncOpWire};
use crate::SyncError;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use xamverse_events::{EngineEvent, EventKind};
use xamverse_network::framing::kinds as envelope_kinds;
use xamverse_network::{Envelope, PeerConnection};
use xamverse_storage::checksum;
use xamverse_storage::repos::{
    BlobRepo, CheckpointsRepo, JobKind, JobRow, JobStatus, JobsRepo, ObjectsRepo, OpRow, OpsRepo,
};
use xamverse_storage::StorageResult;

use super::engine::SyncEngine;

/// Total bytes emitted as progress events between UI updates.
const PROGRESS_GRANULARITY_BYTES: i64 = 256 * 1024;

impl SyncEngine {
    /// Spawn the background runner. One poll pass processes up to a bounded
    /// number of jobs; oversized backlogs continue next pass (no thundering
    /// herd, no unbounded concurrency).
    pub fn spawn_job_runner(self: &Arc<Self>) -> tokio::task::JoinHandle<()> {
        let engine = self.clone();
        tokio::spawn(async move {
            loop {
                if let Err(err) = engine.run_pass().await {
                    tracing::warn!(%err, "job runner pass failed");
                }
                tokio::time::sleep(super::engine::JOB_POLL_INTERVAL).await;
            }
        })
    }

    /// Process due jobs. Returns how many completed successfully.
    pub async fn run_pass(self: &Arc<Self>) -> Result<usize, SyncError> {
        let due: Vec<JobRow> = {
            let conn = self.db.lock();
            JobsRepo::due(&conn, &xamverse_storage::now_rfc3339(), 8)?
        };
        let mut completed = 0;
        for job in due {
            // Claim: persisted state transition (survives restarts).
            {
                let conn = self.db.lock();
                JobsRepo::mark_status(&conn, &job.job_id, JobStatus::Running, None)?;
            }
            self.events
                .publish(EngineEvent::new(EventKind::SyncStarted {
                    job_id: job.job_id.clone(),
                }));
            match self.execute_job(&job).await {
                Ok(()) => {
                    let conn = self.db.lock();
                    JobsRepo::mark_status(&conn, &job.job_id, JobStatus::Completed, None)?;
                    completed += 1;
                }
                Err(err) => {
                    let conn = self.db.lock();
                    if job.attempts + 1 >= super::engine::MAX_RETRIES {
                        JobsRepo::mark_status(
                            &conn,
                            &job.job_id,
                            JobStatus::Failed,
                            Some(&format!("{err} (retries exhausted)")),
                        )?;
                        drop(conn);
                        self.events
                            .publish(EngineEvent::new(EventKind::TransferFailed {
                                job_id: job.job_id.clone(),
                                error: err.to_string(),
                            }));
                    } else {
                        let delay = backoff(job.attempts + 1);
                        let delta =
                            chrono::TimeDelta::from_std(delay).unwrap_or(chrono::TimeDelta::MAX);
                        let next_at = (chrono::Utc::now() + delta).to_rfc3339();
                        JobsRepo::record_failure(&conn, &job.job_id, &err.to_string(), &next_at)?;
                        drop(conn);
                        self.events
                            .publish(EngineEvent::new(EventKind::TransferPaused {
                                job_id: job.job_id.clone(),
                                reason: format!("retry in {delay:?}: {err}"),
                            }));
                    }
                }
            }
        }
        Ok(completed)
    }

    async fn execute_job(self: &Arc<Self>, job: &JobRow) -> Result<(), SyncError> {
        match job.kind {
            JobKind::PushOp => self.execute_push(job).await,
            JobKind::Pull => self.execute_pull(job).await,
            JobKind::Collect => self.execute_pull(job).await, // collection is a scoped pull
        }
    }

    // -- push ----------------------------------------------------------------

    async fn execute_push(self: &Arc<Self>, job: &JobRow) -> Result<(), SyncError> {
        let Some(op_id) = job.op_id.clone() else {
            return Err(SyncError::Storage(
                xamverse_storage::StorageError::InvalidValue {
                    field: "push job",
                    reason: "missing op_id".into(),
                },
            ));
        };
        let op_row = {
            let conn = self.db.lock();
            OpsRepo::get(&conn, &op_id)?
        };
        let wire = op_row_to_wire(&op_row);
        let school_id = job.school_id.clone();

        self.with_peer_connection(&job.target_device_id, None, |mut conn| {
            let engine = self.clone();
            let wire = wire.clone();
            Box::pin(async move {
                let receipts = engine.push_ops(&mut conn, &school_id, &[wire]).await?;
                for receipt in receipts {
                    match receipt.outcome {
                        OpOutcome::Applied | OpOutcome::Duplicate => {}
                        OpOutcome::Conflict { conflict_id } => {
                            // The receiver recorded the conflict; our job is done
                            // (the receiver's UI resolves it there).
                            tracing::info!(%conflict_id, "receiver recorded a conflict");
                        }
                        OpOutcome::Rejected { reason } => {
                            // Unknown author etc. is actionable; surface it.
                            return Err(SyncError::PeerError {
                                code: "op_rejected".into(),
                                detail: reason,
                            });
                        }
                    }
                }
                conn.channel.goodbye().await;
                Ok(())
            })
        })
        .await
    }

    /// Push a batch of ops, transparently satisfying blob requirements with
    /// resumable chunk transfers before re-pushing.
    pub async fn push_ops(
        &self,
        conn: &mut PeerConnection,
        school_id: &str,
        ops: &[SyncOpWire],
    ) -> Result<Vec<OpReceipt>, SyncError> {
        let mut receipts: Vec<OpReceipt> = self
            .request_typed(
                conn,
                "ops_push",
                &OpsPush {
                    school_id: school_id.to_string(),
                    ops: ops.to_vec(),
                },
            )
            .await?;
        let ops_by_id: HashMap<&str, &SyncOpWire> =
            ops.iter().map(|o| (o.op_id.as_str(), o)).collect();

        // Blob negotiation: bounded rounds, sender streams missing content.
        for _round in 0..super::engine::MAX_BLOB_ROUNDS {
            let mut needed: Vec<&SyncOpWire> = Vec::new();
            for receipt in &receipts {
                if let OpOutcome::Rejected { reason } = &receipt.outcome {
                    if reason.starts_with("blob_required:") {
                        if let Some(op) = ops_by_id.get(receipt.op_id.as_str()) {
                            needed.push(op);
                        }
                    }
                }
            }
            if needed.is_empty() {
                break;
            }
            for op in needed {
                let blob_sha = op
                    .blob_sha256
                    .clone()
                    .ok_or(SyncError::BlobHashMismatch(op.op_id.clone()))?;
                self.stream_blob(conn, school_id, &blob_sha).await?;
            }
            receipts = self
                .request_typed::<Vec<OpReceipt>>(
                    conn,
                    "ops_push",
                    &OpsPush {
                        school_id: school_id.to_string(),
                        ops: ops.to_vec(),
                    },
                )
                .await?;
        }
        Ok(receipts)
    }

    /// Stream one local blob to the peer, resuming at the peer's stored
    /// offset. The receiver's own stored length is the resume checkpoint.
    pub async fn stream_blob(
        &self,
        conn: &mut PeerConnection,
        school_id: &str,
        sha256: &str,
    ) -> Result<(), SyncError> {
        let (local_data, total) = {
            let data = {
                let c = self.db.lock();
                BlobRepo::get(&c, sha256)?
            }
            .ok_or_else(|| SyncError::BlobHashMismatch(sha256.to_string()))?;
            let size = data.len() as i64;
            (data, size)
        };
        // Integrity precondition: our own copy must hash correctly before we
        // claim it is "the" content.
        if checksum(&local_data) != sha256 {
            return Err(SyncError::BlobHashMismatch(sha256.to_string()));
        }

        let status: BlobStatusReply = self
            .request_typed(
                conn,
                "blob_status",
                &BlobStatus {
                    sha256: sha256.to_string(),
                },
            )
            .await?;
        let mut offset = status.stored_bytes;
        if offset > total {
            return Err(SyncError::PeerError {
                code: "blob_state".into(),
                detail: "receiver has more bytes than sender".into(),
            });
        }

        let mut next_progress = offset + PROGRESS_GRANULARITY_BYTES;
        while offset < total {
            let length = (total - offset).min(xamverse_network::framing::MAX_BLOB_CHUNK as i64);
            let chunk = BlobChunk {
                sha256: sha256.to_string(),
                offset,
                total_size: total,
                data_b64: data_encoding_b64(
                    &local_data[offset as usize..(offset + length) as usize],
                ),
                eof: offset + length >= total,
            };
            // Receiver appends at exactly `offset` and replies with its new
            // stored length — the durable checkpoint for resumption.
            let ack: BlobStatusReply = self.request_typed(conn, "blob_put", &chunk).await?;
            offset = ack.stored_bytes;
            if offset >= next_progress || offset >= total {
                self.events.publish(
                    EngineEvent::new(EventKind::TransferProgress {
                        job_id: sha256.to_string(),
                        done: offset as u64,
                        total: total as u64,
                    })
                    .with_school(school_id),
                );
                next_progress = offset + PROGRESS_GRANULARITY_BYTES;
            }
            if ack.stored_bytes > total {
                return Err(SyncError::PeerError {
                    code: "blob_state".into(),
                    detail: "receiver size exceeded total".into(),
                });
            }
        }
        Ok(())
    }

    // -- pull ----------------------------------------------------------------

    /// Manifest-diff pull: request the peer's object summary, fetch ops we
    /// lack, apply them, and advance checkpoints per category.
    pub async fn execute_pull(self: &Arc<Self>, job: &JobRow) -> Result<(), SyncError> {
        let categories: Vec<String> = if job.kind == JobKind::Collect {
            crate::category::RESULT_CATEGORIES
                .iter()
                .map(|s| s.to_string())
                .collect()
        } else {
            Vec::new() // all categories
        };
        self.with_peer_connection(&job.target_device_id, None, |mut conn| {
            let engine = self.clone();
            let school = job.school_id.clone();
            Box::pin(async move {
                let summary = engine.pull_from(&mut conn, &school, &categories).await?;
                tracing::info!(
                    received = summary.applied,
                    duplicates = summary.duplicates,
                    conflicts = summary.conflicts,
                    "pull complete"
                );
                conn.channel.goodbye().await;
                Ok(())
            })
        })
        .await
    }

    /// Pull result payload used by jobs and the collection service.
    pub async fn pull_from(
        &self,
        conn: &mut PeerConnection,
        school_id: &str,
        categories: &[String],
    ) -> Result<PullSummary, SyncError> {
        let mut applied = 0usize;
        let mut duplicates = 0usize;
        let mut conflicts = 0usize;
        let mut pages = 0usize;

        loop {
            let checkpoint = {
                let c = self.db.lock();
                let mut max = 0i64;
                if categories.is_empty() {
                    // Track via the global object watermark per peer.
                    max = CheckpointsRepo::get(&c, school_id, &conn.peer.card.device_id, "*")?;
                } else {
                    for cat in categories {
                        max = max.max(CheckpointsRepo::get(
                            &c,
                            school_id,
                            &conn.peer.card.device_id,
                            cat,
                        )?);
                    }
                }
                max
            };
            let manifest: Manifest = self
                .request_typed(
                    conn,
                    "manifest_request",
                    &ManifestRequest {
                        school_id: school_id.to_string(),
                        categories: categories.to_vec(),
                        since_lamport: checkpoint,
                        limit: super::engine::MANIFEST_PAGE,
                    },
                )
                .await?;
            if manifest.summaries.is_empty() {
                break;
            }

            // Diff: request only what we lack or hold older versions of.
            let want: Vec<String> = {
                let c = self.db.lock();
                manifest
                    .summaries
                    .iter()
                    .filter(|s| {
                        ObjectsRepo::get(&c, school_id, &s.category, &s.object_id)
                            .ok()
                            .flatten()
                            .map(|local| local.current_revision < s.revision)
                            .unwrap_or(true)
                    })
                    .map(|s| s.op_id.clone())
                    .collect()
            };
            if !want.is_empty() {
                let ops_reply: OpsReply = self
                    .request_typed(
                        conn,
                        "ops_get",
                        &OpsGet {
                            school_id: school_id.to_string(),
                            op_ids: want,
                        },
                    )
                    .await?;
                // Any blob-backed ops must be streamed before applying.
                for op in &ops_reply.ops {
                    if let Some(blob_sha) = &op.blob_sha256 {
                        if !self.blob_present(blob_sha)? {
                            self.stream_blob(conn, school_id, blob_sha).await?;
                        }
                    }
                }
                let sender_id = conn.peer.card.device_id.clone();
                let sender_trusted = conn.decision == xamverse_network::TrustDecision::Allow;
                let receipts = self.apply.apply_batch(
                    school_id,
                    &crate::apply::SenderContext {
                        device_id: &sender_id,
                        trusted: sender_trusted,
                    },
                    &ops_reply.ops,
                )?;
                for receipt in receipts {
                    match receipt.outcome {
                        OpOutcome::Applied => applied += 1,
                        OpOutcome::Duplicate => duplicates += 1,
                        OpOutcome::Conflict { .. } => conflicts += 1,
                        OpOutcome::Rejected { reason } => {
                            return Err(SyncError::PeerError {
                                code: "apply_rejected".into(),
                                detail: reason,
                            });
                        }
                    }
                }
                // Collection receipts for finalized attempts that arrived.
                self.record_collection_receipts(school_id, &ops_reply.ops, &sender_id)?;
            }

            // Advance checkpoints.
            {
                let c = self.db.lock();
                if categories.is_empty() {
                    CheckpointsRepo::set(
                        &c,
                        school_id,
                        &conn.peer.card.device_id,
                        "*",
                        manifest.max_lamport,
                    )?;
                } else {
                    for cat in categories {
                        CheckpointsRepo::set(
                            &c,
                            school_id,
                            &conn.peer.card.device_id,
                            cat,
                            manifest.max_lamport,
                        )?;
                    }
                }
            }

            pages += 1;
            if manifest.truncated
                || manifest.summaries.len() == super::engine::MANIFEST_PAGE as usize
            {
                if pages > 1000 {
                    return Err(SyncError::PeerError {
                        code: "manifest_loop".into(),
                        detail: "manifest pagination did not converge".into(),
                    });
                }
                continue;
            }
            break;
        }

        Ok(PullSummary {
            applied,
            duplicates,
            conflicts,
        })
    }

    fn blob_present(&self, sha: &str) -> StorageResult<bool> {
        let c = self.db.lock();
        BlobRepo::has(&c, sha)
    }

    /// Record durable receipts proving collection happened (idempotent per
    /// collector). Only finalized attempts are receipt-eligible.
    fn record_collection_receipts(
        &self,
        school_id: &str,
        ops: &[SyncOpWire],
        source_device_id: &str,
    ) -> StorageResult<()> {
        let collector = self.identity.device_id.clone();
        self.db.tx(|conn| {
            for op in ops {
                if crate::category::RESULT_CATEGORIES.contains(&op.category.as_str())
                    && !op.tombstone
                {
                    xamverse_storage::repos::CollectionReceiptsRepo::put(
                        conn,
                        &xamverse_storage::repos::CollectionReceiptRow {
                            receipt_id: uuid::Uuid::now_v7().to_string(),
                            attempt_id: op.object_id.clone(),
                            school_id: school_id.to_string(),
                            collector_device_id: collector.clone(),
                            source_device_id: source_device_id.to_string(),
                            collected_at: xamverse_storage::now_rfc3339(),
                            content_sha256: op.payload_sha256.clone(),
                        },
                    )?;
                }
            }
            Ok(())
        })
    }

    // -- small helpers --------------------------------------------------------

    pub(crate) async fn request_typed<T: serde::de::DeserializeOwned>(
        &self,
        conn: &mut PeerConnection,
        kind: &str,
        payload: &impl serde::Serialize,
    ) -> Result<T, SyncError> {
        let envelope = conn
            .request(Envelope::new(kind, serde_json::to_value(payload)?))
            .await?;
        if envelope.kind == envelope_kinds::ERROR {
            let err: ErrorPayload = serde_json::from_value(envelope.payload.clone())?;
            return Err(SyncError::PeerError {
                code: err.code,
                detail: err.detail,
            });
        }
        Ok(serde_json::from_value(envelope.payload)?)
    }

    pub fn enqueue_job(
        &self,
        school_id: &str,
        target: &str,
        kind: JobKind,
        op_id: Option<String>,
    ) -> StorageResult<String> {
        let job_id = uuid::Uuid::now_v7().to_string();
        let now = xamverse_storage::now_rfc3339();
        let conn = self.db.lock();
        JobsRepo::insert(
            &conn,
            &JobRow {
                job_id: job_id.clone(),
                school_id: school_id.to_string(),
                target_device_id: target.to_string(),
                op_id,
                kind,
                status: JobStatus::Queued,
                attempts: 0,
                next_attempt_at: Some(now.clone()),
                last_error: None,
                created_at: now.clone(),
                updated_at: now,
            },
        )?;
        self.events
            .publish(EngineEvent::new(EventKind::SyncRequested {
                job_id: job_id.clone(),
            }));
        Ok(job_id)
    }
}

/// Pull outcome summary for diagnostics and the collection dashboard.
#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
pub struct PullSummary {
    pub applied: usize,
    pub duplicates: usize,
    pub conflicts: usize,
}

/// Response for ops_get: full op rows including inline payloads.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpsReply {
    pub school_id: String,
    pub ops: Vec<SyncOpWire>,
}

pub(crate) fn op_row_to_wire(row: &OpRow) -> SyncOpWire {
    SyncOpWire {
        op_id: row.op_id.clone(),
        school_id: row.school_id.clone(),
        category: row.category.clone(),
        object_id: row.object_id.clone(),
        revision: row.revision,
        base_revision: row.base_revision,
        author_device_id: row.author_device_id.clone(),
        lamport: row.lamport,
        tombstone: row.tombstone,
        schema_version: row.schema_version,
        payload_sha256: row.payload_sha256.clone(),
        payload_json: row.payload_json.clone(),
        blob_sha256: row.blob_sha256.clone(),
        signature: row.signature.clone(),
    }
}

fn data_encoding_b64(data: &[u8]) -> String {
    data_encoding::BASE64.encode(data)
}

/// Exponential backoff with jitter: base * 2^attempt, capped, ±25% jitter.
pub fn backoff(attempt: i64) -> Duration {
    // Explicit shift bound + parens: `as` and `<<` precedence together are
    // unreadable, and a negative attempt would panic the shift.
    let shift = attempt.clamp(0, 16) as u32;
    let exp = super::engine::RETRY_BASE.as_millis() as u64 * (1u64 << shift);
    let capped = exp.min(super::engine::RETRY_CAP.as_millis() as u64);
    let jitter = (capped / 4) as i64;
    let offset = rand_offset(-jitter, jitter);
    Duration::from_millis((capped as i64 + offset).max(100) as u64)
}

fn rand_offset(min: i64, max: i64) -> i64 {
    use rand::Rng;
    if max <= min {
        return 0;
    }
    rand::thread_rng().gen_range(min..=max)
}
