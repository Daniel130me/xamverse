//! Licence certificate persistence. State transitions are computed by
//! `xamverse-licensing`; this repo only stores certificates and reads them
//! back.

use super::exec;
use crate::error::{StorageError, StorageResult};
use rusqlite::{params, Connection};

#[derive(Debug, Clone, serde::Serialize)]
pub struct LicenceRow {
    pub licence_id: String,
    pub school_id: Option<String>,
    pub plan: String,
    pub status: String,
    pub device_id: String,
    pub device_fingerprint: String,
    pub features_json: String,
    pub device_limit: i64,
    pub issued_at: Option<String>,
    pub not_before: Option<String>,
    pub expires_at: Option<String>,
    pub grace_until: Option<String>,
    pub activated_at: Option<String>,
    pub activation_mode: Option<String>,
    /// Full signed certificate — kept verbatim for audit and re-verification.
    pub raw_cert: String,
    pub signature: String,
    pub imported_at: String,
}

pub struct LicencesRepo;

impl LicencesRepo {
    /// Store a newly imported certificate. The most recent import wins;
    /// history is retained via the audit log.
    pub fn put(conn: &Connection, licence: &LicenceRow) -> StorageResult<()> {
        exec(
            conn,
            "INSERT INTO licences
                (licence_id, school_id, plan, status, device_id, device_fingerprint,
                 features_json, device_limit, issued_at, not_before, expires_at,
                 grace_until, activated_at, activation_mode, raw_cert, signature, imported_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(licence_id) DO UPDATE SET
                status = excluded.status,
                activated_at = COALESCE(excluded.activated_at, licences.activated_at),
                activation_mode = COALESCE(excluded.activation_mode, licences.activation_mode),
                imported_at = excluded.imported_at",
            params![
                licence.licence_id,
                licence.school_id,
                licence.plan,
                licence.status,
                licence.device_id,
                licence.device_fingerprint,
                licence.features_json,
                licence.device_limit,
                licence.issued_at,
                licence.not_before,
                licence.expires_at,
                licence.grace_until,
                licence.activated_at,
                licence.activation_mode,
                licence.raw_cert,
                licence.signature,
                licence.imported_at,
            ],
        )?;
        Ok(())
    }

    /// The licence currently governing this installation (latest import).
    pub fn current(conn: &Connection) -> StorageResult<Option<LicenceRow>> {
        let mut stmt = conn.prepare_cached(&format!(
            "{} ORDER BY imported_at DESC LIMIT 1",
            Self::SELECT
        ))?;
        let mut rows = stmt.query([])?;
        match rows.next()? {
            Some(row) => Ok(Some(Self::map_row(row)?)),
            None => Ok(None),
        }
    }

    pub fn update_status(conn: &Connection, licence_id: &str, status: &str) -> StorageResult<()> {
        let changed = exec(
            conn,
            "UPDATE licences SET status = ?2 WHERE licence_id = ?1",
            params![licence_id, status],
        )?;
        if changed == 0 {
            return Err(StorageError::NotFound {
                entity: "licence",
                id: licence_id.to_string(),
            });
        }
        Ok(())
    }

    const SELECT: &'static str = "SELECT licence_id, school_id, plan, status, device_id,
                 device_fingerprint, features_json, device_limit, issued_at, not_before,
                 expires_at, grace_until, activated_at, activation_mode, raw_cert,
                 signature, imported_at
          FROM licences";

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LicenceRow> {
        Ok(LicenceRow {
            licence_id: row.get(0)?,
            school_id: row.get(1)?,
            plan: row.get(2)?,
            status: row.get(3)?,
            device_id: row.get(4)?,
            device_fingerprint: row.get(5)?,
            features_json: row.get(6)?,
            device_limit: row.get(7)?,
            issued_at: row.get(8)?,
            not_before: row.get(9)?,
            expires_at: row.get(10)?,
            grace_until: row.get(11)?,
            activated_at: row.get(12)?,
            activation_mode: row.get(13)?,
            raw_cert: row.get(14)?,
            signature: row.get(15)?,
            imported_at: row.get::<_, String>(16)?,
        })
    }
}
