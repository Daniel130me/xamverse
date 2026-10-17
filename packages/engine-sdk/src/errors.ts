/**
 * Engine error shape and normalization.
 *
 * Contract: docs/phase2/ENGINE_API.md §2. Two wire shapes exist:
 *  - engine/desktop JSON errors: { error: { code, permission?, message } }
 *  - browser bridge errors:      { error: "<message>" } + HTTP status class
 * The SDK normalizes both into one EngineError with a stable machine code.
 */

/** Stable machine codes (catalogue in ENGINE_API.md §2). */
export const ENGINE_ERROR_CODES = [
  'invalid_credentials',
  'account_suspended',
  'locked_out',
  'session_locked',
  'session_invalid',
  'reauthentication_required',
  'permission_denied',
  'not_found',
  'invalid_value',
  'already_exists',
  'constraint',
  'schema_too_new',
  'migration_checksum_drift',
  'database_unreadable',
  'no_address',
  'peer_error',
  'network',
  'blob_hash_mismatch',
  'device_mismatch',
  'not_yet_valid',
  'expired',
  'invalid',
  'bad_magic',
  'authentication_failed',
  'content_hash_mismatch',
  'integrity_check_failed',
  'format_too_new',
  'platform_mismatch',
  'downgrade_refused',
  'schema_incompatible',
  'hash_mismatch',
  'interlock_blocked',
  'already_running',
] as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

// Scaffold-scoped codes (not part of the engine catalogue).
export const SCAFFOLD_CODES = ['unsupported_on_browser_adapter', 'not_implemented_in_scaffold'] as const;

export class EngineError extends Error {
  readonly code: string;
  /** Present when code === 'permission_denied' (audited engine-side). */
  readonly permission?: string;
  /** HTTP status, browser adapter only. */
  readonly status?: number;

  constructor(code: string, message: string, opts?: { permission?: string; status?: number }) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.permission = opts?.permission;
    this.status = opts?.status;
  }
}

type StructuredErrorBody = { error: { code?: string; permission?: string; message?: string } };
type BridgeErrorBody = { error: string };

/**
 * Heuristic mapping from the bridge's status + message to the catalogue.
 * NOTE(heuristic): the bridge currently serializes errors as plain strings,
 * so status carries the class; when the bridge upgrades to structured codes
 * (§2 plan), this table shrinks to a pass-through. Flagged as non-standard
 * until then.
 */
const STATUS_TO_CODE: Record<number, EngineErrorCode> = {
  401: 'invalid_credentials',
  403: 'permission_denied',
  404: 'not_found',
  409: 'already_exists',
  422: 'invalid_value',
  429: 'locked_out',
  503: 'network',
};

export function normalizeError(status: number, body: unknown): EngineError {
  // Structured engine shape (already carries a stable code).
  const structured = body as StructuredErrorBody;
  if (structured && typeof structured.error === 'object' && structured.error !== null) {
    return new EngineError(structured.error.code ?? 'network', structured.error.message ?? 'engine error', {
      permission: structured.error.permission,
      status,
    });
  }
  // Bridge shape: { error: "<message>" } + status class.
  const bridge = body as BridgeErrorBody;
  const message = typeof bridge?.error === 'string' ? bridge.error : `HTTP ${status}`;
  const code = STATUS_TO_CODE[status] ?? 'network';
  return new EngineError(code, message, { status });
}
