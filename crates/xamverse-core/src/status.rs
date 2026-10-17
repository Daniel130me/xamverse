//! Diagnostics read-model (CLI `diagnostics`, web `/_diagnostics`, Tauri).

use crate::Engine;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct EngineStatus {
    pub device_id: String,
    pub device_name: String,
    pub fingerprint: String,
    pub platform: String,
    pub app_version: String,
    pub data_dir: String,
    pub schema_version: i64,
    pub integrity: String,
    pub peer_port: u16,
    pub mdns_enabled: bool,
    pub licence_status: String,
    pub schools: Vec<SchoolSummary>,
    pub tables: Vec<TableCount>,
    pub sync_queue: SyncQueueSummary,
    pub recent_events: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchoolSummary {
    pub school_id: String,
    pub name: String,
    pub users: i64,
    pub trusted_peers: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableCount {
    pub table: String,
    pub rows: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncQueueSummary {
    pub queued: i64,
    pub failed: i64,
    pub completed: i64,
}

impl Engine {
    /// Full diagnostics snapshot. One pass, batched queries (performance).
    pub fn status(&self) -> xamverse_storage::StorageResult<EngineStatus> {
        let integrity = self.db.quick_check()?;
        let schema_version: i64 = {
            let conn = self.db.lock();
            conn.query_row(
                "SELECT COALESCE(MAX(version), 0) FROM _schema_migrations",
                [],
                |r| r.get(0),
            )?
        };
        let schools: Vec<SchoolSummary> = {
            let conn = self.db.lock();
            xamverse_storage::repos::SchoolsRepo::list(&conn)?
                .into_iter()
                .map(|school| {
                    let users = row_count(&conn, "users", Some((&school.school_id, "school_id")));
                    let trusted = trusted_count(&conn, &school.school_id);
                    SchoolSummary {
                        school_id: school.school_id,
                        name: school.name,
                        users,
                        trusted_peers: trusted,
                    }
                })
                .collect()
        };
        let tables = self
            .db
            .table_summary()?
            .into_iter()
            .map(|(table, rows)| TableCount { table, rows })
            .collect();
        let sync_queue = {
            let conn = self.db.lock();
            SyncQueueSummary {
                queued: count_where(&conn, "sync_jobs", "status IN ('queued','running')"),
                failed: count_where(&conn, "sync_jobs", "status = 'failed'"),
                completed: count_where(&conn, "sync_jobs", "status = 'completed'"),
            }
        };
        Ok(EngineStatus {
            device_id: self.identity.device_id.clone(),
            device_name: self.identity.name.clone(),
            fingerprint: self.identity.fingerprint(),
            platform: self.platform().to_string(),
            app_version: self.config.app_version.clone(),
            data_dir: self.config.data_dir.display().to_string(),
            schema_version,
            integrity,
            peer_port: self.config.peer_port,
            mdns_enabled: self.config.enable_mdns,
            licence_status: format!("{:?}", self.licences.effective_status()).to_lowercase(),
            schools,
            tables,
            sync_queue,
            recent_events: self
                .events
                .recent(20)
                .iter()
                .map(|e| e.kind.kind_name())
                .collect(),
        })
    }
}

fn row_count(conn: &xamverse_storage::Connection, table: &str, scope: Option<(&str, &str)>) -> i64 {
    match scope {
        Some((value, column)) => {
            // Table/column names are engine constants; the value is bound.
            conn.query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?1"),
                [value],
                |r| r.get(0),
            )
            .unwrap_or(0)
        }
        None => conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap_or(0),
    }
}

fn trusted_count(conn: &xamverse_storage::Connection, school_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM device_trust WHERE school_id = ?1 AND state = 'trusted'",
        [school_id],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

fn count_where(conn: &xamverse_storage::Connection, table: &str, predicate: &str) -> i64 {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM {table} WHERE {predicate}"),
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}
