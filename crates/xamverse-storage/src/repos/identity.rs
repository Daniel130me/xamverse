//! Devices and the per-school trust store.

use super::exec;
use crate::error::{StorageError, StorageResult};
use crate::now_rfc3339;
use rusqlite::{params, Connection};
use std::str::FromStr;

/// A device known locally — either this installation (`is_local = 1`) or a
/// remote peer that has been seen, paired or is awaiting pairing.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DeviceRow {
    pub device_id: String,
    pub school_id: Option<String>,
    pub name: String,
    pub platform: String,
    pub signing_pk: String,
    pub transport_pk: String,
    pub fingerprint: String,
    pub is_local: bool,
    pub last_seen_at: Option<String>,
}

/// Trust relationship between this device and another, scoped per school.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustState {
    Pending,
    Trusted,
    Revoked,
    Blocked,
}

impl TrustState {
    pub fn as_str(&self) -> &'static str {
        match self {
            TrustState::Pending => "pending",
            TrustState::Trusted => "trusted",
            TrustState::Revoked => "revoked",
            TrustState::Blocked => "blocked",
        }
    }
}

/// String parsing lives in the FromStr trait (clippy::should_implement_trait)
/// so callers can rely on the standard idiom.
impl std::str::FromStr for TrustState {
    type Err = StorageError;

    fn from_str(raw: &str) -> StorageResult<Self> {
        match raw {
            "pending" => Ok(TrustState::Pending),
            "trusted" => Ok(TrustState::Trusted),
            "revoked" => Ok(TrustState::Revoked),
            "blocked" => Ok(TrustState::Blocked),
            other => Err(StorageError::InvalidValue {
                field: "trust state",
                reason: format!("unknown state {other}"),
            }),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TrustRow {
    pub school_id: String,
    pub device_id: String,
    pub state: TrustState,
    pub paired_at: Option<String>,
    pub approved_by: Option<String>,
    pub note: Option<String>,
}

pub struct DevicesRepo;

impl DevicesRepo {
    /// Insert or update a device record. The fingerprint is immutable — a
    /// device whose fingerprint changed is treated as a new identity.
    pub fn upsert(conn: &Connection, device: &DeviceRow) -> StorageResult<()> {
        exec(
            conn,
            "INSERT INTO devices (device_id, school_id, name, platform, signing_pk,
                                  transport_pk, fingerprint, is_local, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(device_id) DO UPDATE SET
                name = excluded.name,
                platform = excluded.platform,
                last_seen_at = excluded.last_seen_at,
                -- school_id / keys / fingerprint never change after creation
                school_id = COALESCE(devices.school_id, excluded.school_id)",
            params![
                device.device_id,
                device.school_id,
                device.name,
                device.platform,
                device.signing_pk,
                device.transport_pk,
                device.fingerprint,
                device.is_local as i64,
                device.last_seen_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, device_id: &str) -> StorageResult<DeviceRow> {
        let mut stmt = conn.prepare_cached(
            "SELECT device_id, school_id, name, platform, signing_pk, transport_pk,
                    fingerprint, is_local, last_seen_at
             FROM devices WHERE device_id = ?1",
        )?;
        stmt.query_row([device_id], Self::map_row)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
                    entity: "device",
                    id: device_id.to_string(),
                },
                other => other.into(),
            })
    }

    pub fn get_by_fingerprint(conn: &Connection, fingerprint: &str) -> StorageResult<DeviceRow> {
        let mut stmt = conn.prepare_cached(
            "SELECT device_id, school_id, name, platform, signing_pk, transport_pk,
                    fingerprint, is_local, last_seen_at
             FROM devices WHERE fingerprint = ?1",
        )?;
        stmt.query_row([fingerprint], Self::map_row)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
                    entity: "device",
                    id: fingerprint.to_string(),
                },
                other => other.into(),
            })
    }

    pub fn get_local(conn: &Connection) -> StorageResult<Option<DeviceRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT device_id, school_id, name, platform, signing_pk, transport_pk,
                    fingerprint, is_local, last_seen_at
             FROM devices WHERE is_local = 1 LIMIT 1",
        )?;
        let mut rows = stmt.query([])?;
        match rows.next()? {
            Some(row) => Ok(Some(Self::map_row(row)?)),
            None => Ok(None),
        }
    }

    pub fn list(conn: &Connection, include_local: bool) -> StorageResult<Vec<DeviceRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT device_id, school_id, name, platform, signing_pk, transport_pk,
                    fingerprint, is_local, last_seen_at
             FROM devices WHERE (?1 = 1 OR is_local = 0) ORDER BY name",
        )?;
        let rows = stmt
            .query_map([include_local as i64], Self::map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Record that a device was seen on the network (diagnostics only).
    pub fn touch_last_seen(conn: &Connection, device_id: &str) -> StorageResult<()> {
        exec(
            conn,
            "UPDATE devices SET last_seen_at = ?2 WHERE device_id = ?1",
            params![device_id, now_rfc3339()],
        )?;
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DeviceRow> {
        Ok(DeviceRow {
            device_id: row.get(0)?,
            school_id: row.get(1)?,
            name: row.get(2)?,
            platform: row.get(3)?,
            signing_pk: row.get(4)?,
            transport_pk: row.get(5)?,
            fingerprint: row.get(6)?,
            is_local: row.get::<_, i64>(7)? != 0,
            last_seen_at: row.get(8)?,
        })
    }
}

pub struct TrustRepo;

impl TrustRepo {
    pub fn set(
        conn: &Connection,
        school_id: &str,
        device_id: &str,
        state: TrustState,
        approved_by: Option<&str>,
        note: Option<&str>,
    ) -> StorageResult<()> {
        let paired_at = if state == TrustState::Trusted {
            Some(now_rfc3339())
        } else {
            None
        };
        exec(
            conn,
            "INSERT INTO device_trust (school_id, device_id, state, paired_at, approved_by, note)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(school_id, device_id) DO UPDATE SET
                state = excluded.state,
                paired_at = COALESCE(excluded.paired_at, device_trust.paired_at),
                approved_by = COALESCE(excluded.approved_by, device_trust.approved_by),
                note = excluded.note",
            params![
                school_id,
                device_id,
                state.as_str(),
                paired_at,
                approved_by,
                note
            ],
        )?;
        Ok(())
    }

    pub fn get(
        conn: &Connection,
        school_id: &str,
        device_id: &str,
    ) -> StorageResult<Option<TrustRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT school_id, device_id, state, paired_at, approved_by, note
             FROM device_trust WHERE school_id = ?1 AND device_id = ?2",
        )?;
        let mut rows = stmt.query(params![school_id, device_id])?;
        match rows.next()? {
            Some(row) => Ok(Some(TrustRow {
                school_id: row.get(0)?,
                device_id: row.get(1)?,
                state: TrustState::from_str(&row.get::<_, String>(2)?)?,
                paired_at: row.get(3)?,
                approved_by: row.get(4)?,
                note: row.get(5)?,
            })),
            None => Ok(None),
        }
    }

    /// The only question the sync/network layers ask: may this device act for
    /// this school right now?
    pub fn is_trusted(conn: &Connection, school_id: &str, device_id: &str) -> StorageResult<bool> {
        let mut stmt = conn.prepare_cached(
            "SELECT 1 FROM device_trust
             WHERE school_id = ?1 AND device_id = ?2 AND state = 'trusted'",
        )?;
        Ok(stmt.exists(params![school_id, device_id])?)
    }

    pub fn list(conn: &Connection, school_id: &str) -> StorageResult<Vec<TrustRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT school_id, device_id, state, paired_at, approved_by, note
             FROM device_trust WHERE school_id = ?1 ORDER BY paired_at DESC",
        )?;
        let rows = stmt
            .query_map([school_id], |row| {
                Ok(TrustRow {
                    school_id: row.get(0)?,
                    device_id: row.get(1)?,
                    state: TrustState::from_str(&row.get::<_, String>(2)?)
                        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                    paired_at: row.get(3)?,
                    approved_by: row.get(4)?,
                    note: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}
