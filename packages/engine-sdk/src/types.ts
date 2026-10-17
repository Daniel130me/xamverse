/**
 * Wire types — serde JSON shapes of the engine's real Rust types.
 *
 * Field names are snake_case ON PURPOSE: the SDK is a zero-mapping
 * pass-through (ENGINE_API.md "the SDK never mutates it"). View-layer
 * mapping belongs to the UI, not the transport, so a renamed Rust field
 * fails loudly here instead of silently shifting values.
 *
 * Shapes cited per namespace in docs/phase2/ENGINE_API.md §3–§10.
 */

// -- auth (§3, SessionContext) ----------------------------------------------
export interface Session {
  token_hash: string;
  user_id: string;
  school_id: string;
  kind: 'desktop' | 'browser';
  created_at: string;
  expires_at: string;
  locked: boolean;
  permissions: string[];
}

// -- peers (§5) --------------------------------------------------------------
export interface PeerAdvertisement {
  device_id: string;
  name: string;
  fingerprint: string;
  protocol_major: number;
  port: number;
  addresses: string[];
}

export interface BootstrapIdentity {
  school_id: string;
  user_id: string;
  username: string;
}

export interface ManualPeerEntry {
  key: string;
  addr: string;
}

export interface PairPending {
  responder_device_id: string;
  responder_name: string;
  responder_fingerprint: string;
}

export type PeerTrustState = 'pending' | 'trusted' | 'revoked' | 'blocked';

// -- sync (§6) ---------------------------------------------------------------
export interface SyncOp {
  op_id: string;
  school_id: string;
  category: string;
  object_id: string;
  revision: number;
  base_revision: number;
  author_device_id: string;
  lamport: number;
  tombstone: boolean;
  schema_version: number;
  payload_sha256: string;
  payload_json: string;
  signature: string;
}

export interface JobRow {
  job_id: string;
  school_id: string;
  target_device_id: string;
  op_id: string | null;
  kind: 'push_op' | 'pull' | 'collect';
  status: 'queued' | 'running' | 'completed' | 'failed';
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PullSummary {
  applied: number;
  duplicates: number;
  conflicts: number;
}

// -- conflicts (§7) ------------------------------------------------------------
export interface ConflictRow {
  conflict_id: string;
  school_id: string;
  category: string;
  object_id: string;
  kind: string;
  incoming_op_id: string;
  local_op_id: string | null;
  incoming_payload_json: string | null;
  strategy: string;
  status: 'open' | 'resolved' | 'deferred';
  resolution: string | null;
  resolved_by: string | null;
  detected_at: string;
  resolved_at: string | null;
}

// -- packages (§8) -------------------------------------------------------------
export interface PackageManifest {
  package_id: string;
  school_id: string;
  assessment_id: string;
  version: number;
  schema_version: number;
  protected_fields: string[];
  approved_by: string | null;
}

// -- attempts (§8) --------------------------------------------------------------
export interface AttemptRow {
  attempt_id: string;
  school_id: string;
  package_id: string;
  student_ref: string;
  status: 'in_progress' | 'finalized';
  device_id: string;
  started_at: string;
  finalized_at: string | null;
  finalize_signature: string | null;
  latest_chain_hash: string;
}

// -- licensing (§9) --------------------------------------------------------------
export type LicenceStatus =
  | 'unactivated'
  | 'active'
  | 'near_expiry'
  | 'grace_period'
  | 'expired'
  | 'invalid'
  | 'revoked';

export interface ActivationRequest {
  device_id: string;
  device_fingerprint: string;
  device_name: string;
  school_hint: string;
  generated_at: string;
  device_public_key: string;
  device_signature: string;
}

// -- audit (§10) -----------------------------------------------------------------
export interface AuditRow {
  seq: number;
  event_id: string;
  school_id: string | null;
  actor_user: string | null;
  actor_device: string | null;
  action: string;
  target: string | null;
  detail_json: string | null;
  at: string;
}

// -- diagnostics (§10, Engine::status()) ------------------------------------------
export interface EngineStatus {
  device_id: string;
  device_name: string;
  fingerprint: string;
  platform: string;
  app_version: string;
  data_dir: string;
  schema_version: number;
  integrity: string;
  peer_port: number;
  mdns_enabled: boolean;
  licence_status: LicenceStatus;
  schools: { school_id: string; name: string; users: number; trusted_peers: number }[];
  tables: { table: string; rows: number }[];
  sync_queue: { queued: number; failed: number; completed: number };
  recent_events: string[];
}

// -- events (§10) ------------------------------------------------------------------
export interface EngineEvent {
  id: string;
  at: string;
  school_id: string | null;
  device_id: string | null;
  type: string;
  data: unknown;
}
