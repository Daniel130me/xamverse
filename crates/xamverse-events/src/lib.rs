//! Typed engine event bus.
//!
//! WHY THIS EXISTS
//! ---------------
//! Every engine subsystem (peers, sync, licensing, backups, updates, security)
//! reports what it does through one typed stream. Consumers:
//!
//! * the desktop shell forwards events to the React UI (Tauri `emit`),
//! * the browser bridge streams authorized subsets over SSE,
//! * the sync runner reacts to peer reconnections,
//! * tests assert on business outcomes without polling databases.
//!
//! Design notes:
//! * `tokio::sync::broadcast` gives cheap multi-consumer fan-out; a slow
//!   consumer simply lags and resynchronizes from `history`.
//! * A bounded in-memory history lets UIs that reconnected recover the events
//!   they missed (`subscribe_since`), satisfying "recovery after temporary UI
//!   disconnection" without persisting every event (durable records live in
//!   the database: sync jobs, audit log, conflicts).

use chrono::{DateTime, Utc};
use std::collections::{HashMap, VecDeque};
use tokio::sync::broadcast;
use uuid::Uuid;

/// Soft cap for one payload carried inside an event (e.g. short error notes).
/// Events are notifications, not data transport — large data lives in the DB.
/// (Enforced socially; payloads are constructed internally by the engine.)
pub const EVENT_PAYLOAD_LIMIT_BYTES: usize = 8 * 1024;

/// Broadcast channel capacity. A full channel means a consumer is lagging
/// more than this many events; it will catch up via history.
const CHANNEL_CAPACITY: usize = 1024;

/// Number of recent events kept for resumable subscriptions.
const HISTORY_CAPACITY: usize = 1000;

/// Every event the engine can emit. Variants map 1:1 to the categories in the
/// Phase 2 specification §18 so the UI can switch on a stable string kind.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum EventKind {
    PeerDiscovered { device_id: String, name: String, addr: String },
    PeerConnected { device_id: String },
    PeerDisconnected { device_id: String },
    DevicePaired { device_id: String, school_id: String },
    DeviceRevoked { device_id: String, school_id: String },
    SyncRequested { job_id: String },
    SyncStarted { job_id: String },
    TransferProgress { job_id: String, done: u64, total: u64 },
    TransferPaused { job_id: String, reason: String },
    TransferResumed { job_id: String },
    TransferCompleted { job_id: String },
    TransferFailed { job_id: String, error: String },
    ConflictDetected { conflict_id: String, category: String, object_id: String },
    ConflictResolved { conflict_id: String, resolution: String },
    PackageReceived { package_id: String, school_id: String },
    SubmissionReceived { attempt_id: String, from_device: String },
    CollectionProgress { job_id: String, received: u64, expected: Option<u64> },
    LicenceStatusChanged { status: String },
    UpdateAvailable { version: String },
    UpdateApplied { version: String },
    BackupCompleted { backup_id: String },
    SecurityAlert { alert: String },
    JobStatusChanged { job_id: String, status: String },
}

impl EventKind {
    /// Stable machine-readable name used for subscription filtering.
    pub fn kind_name(&self) -> &'static str {
        match self {
            EventKind::PeerDiscovered { .. } => "peer.discovered",
            EventKind::PeerConnected { .. } => "peer.connected",
            EventKind::PeerDisconnected { .. } => "peer.disconnected",
            EventKind::DevicePaired { .. } => "device.paired",
            EventKind::DeviceRevoked { .. } => "device.revoked",
            EventKind::SyncRequested { .. } => "sync.requested",
            EventKind::SyncStarted { .. } => "sync.started",
            EventKind::TransferProgress { .. } => "sync.progress",
            EventKind::TransferPaused { .. } => "sync.paused",
            EventKind::TransferResumed { .. } => "sync.resumed",
            EventKind::TransferCompleted { .. } => "sync.completed",
            EventKind::TransferFailed { .. } => "sync.failed",
            EventKind::ConflictDetected { .. } => "conflict.detected",
            EventKind::ConflictResolved { .. } => "conflict.resolved",
            EventKind::PackageReceived { .. } => "package.received",
            EventKind::SubmissionReceived { .. } => "submission.received",
            EventKind::CollectionProgress { .. } => "collection.progress",
            EventKind::LicenceStatusChanged { .. } => "licence.status_changed",
            EventKind::UpdateAvailable { .. } => "update.available",
            EventKind::UpdateApplied { .. } => "update.applied",
            EventKind::BackupCompleted { .. } => "backup.completed",
            EventKind::SecurityAlert { .. } => "security.alert",
            EventKind::JobStatusChanged { .. } => "job.status_changed",
        }
    }
}

/// A single engine event with stable identity and context.
#[derive(Debug, Clone, serde::Serialize)]
pub struct EngineEvent {
    pub id: Uuid,
    pub at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub school_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(flatten)]
    pub kind: EventKind,
}

impl EngineEvent {
    pub fn new(kind: EventKind) -> Self {
        Self {
            id: Uuid::now_v7(),
            at: Utc::now(),
            school_id: None,
            device_id: None,
            kind,
        }
    }

    pub fn with_school(mut self, school_id: impl Into<String>) -> Self {
        self.school_id = Some(school_id.into());
        self
    }

    pub fn with_device(mut self, device_id: impl Into<String>) -> Self {
        self.device_id = Some(device_id.into());
        self
    }
}

/// A receiver that first drains a replay buffer, then follows the live
/// broadcast stream. Exposes the same `recv()` ergonomics as the underlying
/// broadcast receiver.
pub struct ReplayReceiver {
    replay: std::sync::Mutex<VecDeque<EngineEvent>>,
    inner: broadcast::Receiver<EngineEvent>,
}

impl ReplayReceiver {
    /// Next event: replayed history first (oldest first), then live events.
    pub async fn recv(&mut self) -> Result<EngineEvent, broadcast::error::RecvError> {
        loop {
            if let Ok(mut replay) = self.replay.lock() {
                if let Some(event) = replay.pop_front() {
                    return Ok(event);
                }
            }
            match self.inner.recv().await {
                // A Lagged gap means this consumer was slow; the events were
                // lost from the channel but recent history remains queryable.
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, "event consumer lagged");
                    continue;
                }
                other => return other,
            }
        }
    }
}

/// Multi-consumer, resumable event hub.
pub struct EventBus {
    tx: broadcast::Sender<EngineEvent>,
    history: std::sync::Mutex<VecDeque<EngineEvent>>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(CHANNEL_CAPACITY);
        Self {
            tx,
            history: std::sync::Mutex::new(VecDeque::with_capacity(HISTORY_CAPACITY)),
        }
    }

    /// Publish to all current subscribers and remember the event for
    /// resumable subscriptions. Never blocks the publisher.
    pub fn publish(&self, event: EngineEvent) {
        {
            let mut history = self
                .history
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if history.len() == HISTORY_CAPACITY {
                history.pop_front();
            }
            history.push_back(event.clone());
        }
        // A send error only means there are no subscribers yet.
        let _ = self.tx.send(event);
    }

    /// Subscribe to every future event.
    pub fn subscribe(&self) -> broadcast::Receiver<EngineEvent> {
        self.tx.subscribe()
    }

    /// Subscribe and replay events newer than `since_id` (exclusive) before
    /// switching to live events. Used by UIs that reconnect after a drop.
    /// The replay travels through a dedicated buffer because a broadcast
    /// receiver can only observe events published after it subscribed.
    pub fn subscribe_since(&self, since_id: Uuid) -> ReplayReceiver {
        let replay: Vec<EngineEvent> = {
            let history = self
                .history
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            history.iter().filter(|e| e.id > since_id).cloned().collect()
        };
        ReplayReceiver {
            replay: std::sync::Mutex::new(replay.into_iter().collect()),
            inner: self.subscribe(),
        }
    }

    /// Snapshot of recent history (oldest first) — for diagnostics endpoints.
    pub fn recent(&self, limit: usize) -> Vec<EngineEvent> {
        let history = self
            .history
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        history.iter().rev().take(limit).rev().cloned().collect()
    }

    /// Map of event kind name -> count in the recent history window.
    pub fn recent_summary(&self) -> HashMap<&'static str, usize> {
        let mut out = HashMap::new();
        let history = self
            .history
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for e in history.iter() {
            *out.entry(e.kind.kind_name()).or_default() += 1;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: EventKind) -> EngineEvent {
        EngineEvent::new(kind)
    }

    #[tokio::test]
    async fn subscribers_receive_published_events() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe();
        bus.publish(ev(EventKind::PeerConnected { device_id: "d1".into() }));
        let got = rx.recv().await.expect("event");
        assert_eq!(got.kind.kind_name(), "peer.connected");
    }

    #[tokio::test]
    async fn subscribe_since_replays_missed_events() {
        let bus = EventBus::new();
        let first = ev(EventKind::SyncStarted { job_id: "j1".into() });
        bus.publish(first.clone());
        let second = ev(EventKind::TransferCompleted { job_id: "j1".into() });
        bus.publish(second);

        // "Reconnect" having seen only the first event.
        let mut rx = bus.subscribe_since(first.id);
        let got = rx.recv().await.expect("replayed event");
        assert_eq!(got.kind.kind_name(), "sync.completed");
    }

    #[test]
    fn history_is_bounded() {
        let bus = EventBus::new();
        for i in 0..(HISTORY_CAPACITY + 50) {
            bus.publish(ev(EventKind::JobStatusChanged { job_id: format!("j{i}"), status: "queued".into() }));
        }
        assert_eq!(bus.recent(usize::MAX).len(), HISTORY_CAPACITY);
    }

    #[test]
    fn events_serialize_with_stable_kind_names() {
        let e = ev(EventKind::SecurityAlert { alert: "login spike".into() });
        let json = serde_json::to_value(&e).expect("serializable");
        assert_eq!(json["type"], "security_alert");
    }
}
