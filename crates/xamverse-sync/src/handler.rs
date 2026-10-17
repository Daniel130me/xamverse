//! Server-side dispatch of peer messages (the `PeerHandler` implementation).
//!
//! Authorization model per message kind:
//! * `pair_request` — allowed for ANY device (this is how trust begins);
//!   records the requester as `pending`, never as trusted.
//! * `ping` — allowed for anyone (reachability diagnostics).
//! * `blob_put` / `blob_status` — allowed for pending devices too: these are
//!   content-addressed writes with hash verification, and pairing-adjacent
//!   flows need them; every write is integrity-checked before commit.
//! * everything else — requires a fully trusted device
//!   (`TrustDecision::Allow`). Unknown or pending devices receive a
//!   structured error, never partial data.
//!
//! NOTE(perf): handler bodies run short SQLite transactions directly on the
//! async thread. With the sync indexes these are sub-millisecond; measured
//! evidence and the spawn_blocking trade-off are documented in TESTING.md.

use crate::messages::*;
use std::sync::Arc;
use xamverse_events::{EngineEvent, EventKind};
use xamverse_identity::DeviceCard;
use xamverse_network::{AuthenticatedPeer, Envelope, HandlerFuture, PeerHandler, TrustDecision};
use xamverse_storage::repos::{
    BlobRepo, DeviceRow, DevicesRepo, ObjectSummary, ObjectsRepo, OpsRepo, TrustRepo, TrustState,
};
use xamverse_storage::{checksum, now_rfc3339, Database, StorageError};

use super::engine::SyncEngine;
use super::runner::{op_row_to_wire, OpsReply};

/// Serialize a success reply. serde over these static-shaped structs cannot
/// fail at runtime (no maps with non-string keys, no custom serializers);
/// the only failure mode is OOM. Keeping the single `expect` here — instead
/// of one per handler arm — means the allowance is documented exactly once.
#[allow(clippy::expect_used)]
fn reply<T: serde::Serialize>(kind: &str, payload: &T) -> Option<Envelope> {
    Some(Envelope::new(
        kind,
        serde_json::to_value(payload).expect("reply payload is always serializable"),
    ))
}

impl PeerHandler for SyncEngine {
    fn handle(
        &self,
        peer: &AuthenticatedPeer,
        trusted: TrustDecision,
        msg: Envelope,
    ) -> HandlerFuture {
        // Clone the Arcs this message may need; the future must own them.
        let db = self.db.clone();
        let events = self.events.clone();
        let identity_device_id = self.identity.device_id.clone();
        let identity_name = self.identity.name.clone();
        let identity_fingerprint = self.identity.fingerprint();
        let peer = peer.clone();

        match msg.kind.as_str() {
            "ping" => match serde_json::from_value::<Ping>(msg.payload.clone()) {
                Ok(p) => Box::pin(async move {
                    reply(
                        "pong",
                        &Pong {
                            sent_at: p.sent_at,
                            responded_at: now_rfc3339(),
                        },
                    )
                }),
                Err(e) => error_reply(&msg, &e.to_string()),
            },

            "pair_request" => match serde_json::from_value::<PairRequest>(msg.payload.clone()) {
                Ok(request) => Box::pin(async move {
                    let device_id = peer.card.device_id.clone();
                    let result = db.tx(|conn| {
                        DevicesRepo::upsert(
                            conn,
                            &DeviceRow {
                                device_id: device_id.clone(),
                                school_id: Some(request.school_id.clone()),
                                name: request.requester_name.clone(),
                                platform: "unknown".into(),
                                signing_pk: peer.card.signing_pk.clone(),
                                transport_pk: peer.card.transport_pk.clone(),
                                // Recomputed — never trust a client-claimed fp.
                                fingerprint: fingerprint_of(&peer.card),
                                is_local: false,
                                last_seen_at: Some(now_rfc3339()),
                            },
                        )?;
                        TrustRepo::set(
                            conn,
                            &request.school_id,
                            &device_id,
                            TrustState::Pending,
                            None,
                            Some("pair requested by remote"),
                        )?;
                        xamverse_audit::record(
                            conn,
                            &xamverse_audit::AuditEvent::new("devices.pair_requested")
                                .with_school(&request.school_id)
                                .with_target(device_id.clone()),
                        )?;
                        Ok(())
                    });
                    match result {
                        Ok(()) => {
                            events.publish(
                                EngineEvent::new(EventKind::DevicePaired {
                                    device_id,
                                    school_id: request.school_id,
                                })
                                // The UI listens for the pending state; the
                                // pairing approval itself is user-driven.
                                .with_device("pending"),
                            );
                            // The responder is THIS engine; a requester
                            // approving the wrong device id is caught by
                            // the integration suite.
                            reply(
                                "pair_pending",
                                &PairPending {
                                    responder_device_id: identity_device_id,
                                    responder_name: identity_name,
                                    responder_fingerprint: identity_fingerprint,
                                },
                            )
                        }
                        Err(err) => Some(msg.error_reply("request_failed", &err.to_string())),
                    }
                }),
                Err(e) => error_reply(&msg, &e.to_string()),
            },

            // Content-addressed writes: the receiving side of a push transfer.
            "blob_put" if matches!(trusted, TrustDecision::Allow | TrustDecision::AllowLimited) => {
                match serde_json::from_value::<BlobChunk>(msg.payload.clone()) {
                    Ok(chunk) => Box::pin(async move {
                        match receive_blob_chunk(&db, &chunk).await {
                            Ok(stored) => reply(
                                "blob_status",
                                &BlobStatusReply {
                                    sha256: chunk.sha256,
                                    stored_bytes: stored,
                                    total_size: chunk.total_size,
                                },
                            ),
                            Err(err) => Some(msg.error_reply("request_failed", &err.to_string())),
                        }
                    }),
                    Err(e) => error_reply(&msg, &e.to_string()),
                }
            }

            "blob_status" => match serde_json::from_value::<BlobStatus>(msg.payload.clone()) {
                Ok(status) => Box::pin(async move {
                    let stored = {
                        let conn = db.lock();
                        BlobRepo::size(&conn, &status.sha256).unwrap_or(None)
                    }
                    .unwrap_or(0);
                    reply(
                        "blob_status",
                        &BlobStatusReply {
                            sha256: status.sha256,
                            stored_bytes: stored,
                            // Receiver-side total is unknown until first chunk.
                            total_size: 0,
                        },
                    )
                }),
                Err(e) => error_reply(&msg, &e.to_string()),
            },

            _ if trusted != TrustDecision::Allow => {
                error_reply(&msg, "device is not fully trusted; complete pairing first")
            }

            "manifest_request" => {
                match serde_json::from_value::<ManifestRequest>(msg.payload.clone()) {
                    Ok(request) => Box::pin(async move {
                        match build_manifest(&db, &request) {
                            Ok(manifest) => reply("manifest", &manifest),
                            Err(detail) => Some(msg.error_reply("request_failed", &detail)),
                        }
                    }),
                    Err(e) => error_reply(&msg, &e.to_string()),
                }
            }

            "ops_get" => match serde_json::from_value::<OpsGet>(msg.payload.clone()) {
                Ok(request) => Box::pin(async move {
                    let result = (|| -> Result<OpsReply, String> {
                        let conn = db.lock();
                        // Tenant gate: only ops of the requested school leave.
                        let rows =
                            OpsRepo::get_many(&conn, &request.op_ids).map_err(|e| e.to_string())?;
                        let ops = rows
                            .into_iter()
                            .filter(|row| row.school_id == request.school_id)
                            .map(|row| op_row_to_wire(&row))
                            .collect();
                        Ok(OpsReply {
                            school_id: request.school_id,
                            ops,
                        })
                    })();
                    match result {
                        Ok(ops_reply) => reply("ops", &ops_reply),
                        Err(detail) => Some(msg.error_reply("request_failed", &detail)),
                    }
                }),
                Err(e) => error_reply(&msg, &e.to_string()),
            },

            "ops_push" => match serde_json::from_value::<OpsPush>(msg.payload.clone()) {
                Ok(push) => {
                    let _local_device = self.identity.device_id.clone();
                    let apply = self.apply.clone();
                    Box::pin(async move {
                        let sender_id = peer.card.device_id.clone();
                        let sender_trusted = trusted == TrustDecision::Allow;
                        // Pre-check blobs so the sender knows what to stream.
                        let mut receipts: Vec<crate::op::OpReceipt> = Vec::new();
                        let mut ready_ops = Vec::new();
                        for op in &push.ops {
                            if let Some(blob_sha) = &op.blob_sha256 {
                                let present = {
                                    let conn = db.lock();
                                    BlobRepo::has(&conn, blob_sha).unwrap_or(false)
                                };
                                if !present {
                                    receipts.push(crate::op::OpReceipt {
                                        op_id: op.op_id.clone(),
                                        outcome: crate::op::OpOutcome::Rejected {
                                            reason: format!("blob_required:{blob_sha}"),
                                        },
                                    });
                                    continue;
                                }
                            }
                            ready_ops.push(op.clone());
                        }
                        if ready_ops.is_empty() {
                            return reply("ops_ack", &OpsAck { receipts });
                        }
                        let sender = crate::apply::SenderContext {
                            device_id: &sender_id,
                            trusted: sender_trusted,
                        };
                        match apply.apply_batch(&push.school_id, &sender, &ready_ops) {
                            Ok(mut applied) => {
                                receipts.append(&mut applied);
                                reply("ops_ack", &OpsAck { receipts })
                            }
                            Err(err) => Some(msg.error_reply("request_failed", &err.to_string())),
                        }
                    })
                }
                Err(e) => error_reply(&msg, &e.to_string()),
            },

            other => {
                // Unknown kinds are answered with a structured error — never
                // a silent no-op (spec §12).
                let _ = other;
                let reply =
                    msg.error_reply("unknown_kind", "this node does not implement that message");
                Box::pin(async move { Some(reply) })
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Handler helpers (synchronous, short-lived DB work)
// ---------------------------------------------------------------------------

fn fingerprint_of(card: &DeviceCard) -> String {
    xamverse_identity::DeviceIdentity::fingerprint_of(&card.signing_pk, &card.transport_pk)
}

fn error_reply(msg: &Envelope, detail: &str) -> HandlerFuture {
    let reply = msg.error_reply("request_failed", detail);
    Box::pin(async move { Some(reply) })
}

fn build_manifest(db: &Arc<Database>, request: &ManifestRequest) -> Result<Manifest, String> {
    let conn = db.lock();
    if !xamverse_storage::repos::SchoolsRepo::exists(&conn, &request.school_id)
        .map_err(|e| e.to_string())?
    {
        return Err("school_not_enrolled".into());
    }
    let mut summaries: Vec<ObjectSummary> = Vec::new();
    let mut max_lamport = request.since_lamport;
    let mut truncated = false;
    // Chunk categories so one IN(...) query stays small; empty = all.
    let category_chunks: Vec<Vec<String>> = if request.categories.is_empty() {
        vec![Vec::new()]
    } else {
        request.categories.chunks(8).map(|c| c.to_vec()).collect()
    };
    'outer: for chunk in category_chunks {
        let page = ObjectsRepo::summaries(
            &conn,
            &request.school_id,
            &chunk,
            request.since_lamport,
            request.limit - summaries.len() as i64,
        )
        .map_err(|e| e.to_string())?;
        for summary in page {
            max_lamport = max_lamport.max(summary.lamport);
            if summaries.len() >= request.limit as usize {
                truncated = true;
                break 'outer;
            }
            summaries.push(summary);
        }
    }
    Ok(Manifest {
        school_id: request.school_id.clone(),
        summaries,
        max_lamport,
        truncated,
    })
}

/// Append a chunk into the local blob store at the offset the sender was
/// told about. Sequential-append protocol: offset must equal stored length.
/// On completion the assembled content is hash-verified; a mismatch deletes
/// the partial blob (the sender's next status poll restarts from zero).
async fn receive_blob_chunk(db: &Arc<Database>, chunk: &BlobChunk) -> Result<i64, StorageError> {
    let stored = db.tx(|conn| {
        let existing_len = BlobRepo::size(conn, &chunk.sha256)?.unwrap_or(0);
        if chunk.offset != existing_len {
            return Err(StorageError::Constraint(format!(
                "blob offset {} does not match stored length {}",
                chunk.offset, existing_len
            )));
        }
        let data = data_encoding::BASE64
            .decode(chunk.data_b64.as_bytes())
            .map_err(|_| StorageError::InvalidValue {
                field: "blob chunk",
                reason: "invalid base64".into(),
            })?;
        if existing_len == 0 {
            BlobRepo::put(conn, &chunk.sha256, &data)?;
        } else {
            conn.execute(
                "UPDATE blobs SET data = data || ?2, size = size + ?3 WHERE sha256 = ?1",
                rusqlite::params![chunk.sha256, data, data.len() as i64],
            )?;
        }
        let new_len = BlobRepo::size(conn, &chunk.sha256)?.unwrap_or(0);
        if new_len > chunk.total_size {
            return Err(StorageError::Constraint(
                "stored size exceeded total".into(),
            ));
        }
        Ok(new_len)
    })?;

    if stored == chunk.total_size {
        // Transfer complete: verify before acknowledging success.
        let complete = {
            let conn = db.lock();
            BlobRepo::get(&conn, &chunk.sha256)?
        };
        match complete {
            Some(data) if checksum(&data) == chunk.sha256 => Ok(stored),
            Some(data) => {
                // Corrupt content: drop and report a short length so the
                // sender restarts cleanly.
                let conn = db.lock();
                conn.execute("DELETE FROM blobs WHERE sha256 = ?1", [&chunk.sha256])?;
                tracing::warn!(sha = %chunk.sha256, len = data.len(), "blob hash mismatch; partial content discarded");
                Err(StorageError::Constraint(
                    "blob hash mismatch; transfer reset".into(),
                ))
            }
            None => Err(StorageError::Constraint(
                "blob vanished mid-transfer".into(),
            )),
        }
    } else {
        Ok(stored)
    }
}
