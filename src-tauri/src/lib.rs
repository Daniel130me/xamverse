//! XamVerse desktop composition root.

mod commands;
mod keystore;

use commands::*;
use std::{net::SocketAddr, sync::Arc};
use tauri::{Emitter, Manager};
use xamverse_core::{Engine, EngineConfig};

struct Lifecycle {
    browser_shutdown: tokio::sync::watch::Sender<bool>,
}

pub fn run() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn,xamverse=info"));
    // `try_init` keeps embedding/test hosts free to install their own
    // subscriber while ensuring packaged applications emit diagnostics.
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();

    let app = tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?.join("engine");
            let key_store = Arc::new(keystore::PlatformKeyStore::for_data_dir(&data_dir)?);
            let config = EngineConfig {
                data_dir,
                device_name: device_name(),
                trusted_issuer_pks: configured_keys(option_env!("XAMVERSE_ISSUER_PUBLIC_KEYS")),
                trusted_release_pks: configured_keys(option_env!("XAMVERSE_RELEASE_PUBLIC_KEYS")),
                app_version: app.package_info().version.to_string(),
                ..EngineConfig::default()
            };

            let engine = Engine::init_with_keystore(config, key_store)?;
            tauri::async_runtime::block_on(engine.start())?;

            let (browser_shutdown, shutdown_rx) = tokio::sync::watch::channel(false);
            let frontend_dir = browser_frontend_dir(app);
            let web = xamverse_web::WebServer::bind(
                engine.clone(),
                xamverse_web::WebConfig {
                    bind: SocketAddr::from(([0, 0, 0, 0], engine.config.browser_port)),
                    allowed_origins: Vec::new(),
                    frontend_dir,
                },
            )?;
            tauri::async_runtime::spawn(async move {
                if let Err(error) = web.run(shutdown_rx).await {
                    tracing::error!(%error, "browser bridge stopped unexpectedly");
                }
            });

            let mut events = engine.events.subscribe();
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match events.recv().await {
                        Ok(event) => {
                            if let Err(error) = handle.emit("engine-event", event) {
                                tracing::warn!(%error, "failed to forward engine event");
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                            tracing::warn!(skipped, "desktop event forwarder lagged");
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            });

            app.manage(DesktopState::new(engine));
            app.manage(Lifecycle { browser_shutdown });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine_auth_bootstrap_status,
            engine_auth_bootstrap,
            engine_auth_login,
            engine_auth_authenticate,
            engine_auth_logout,
            engine_auth_lock_session,
            engine_auth_unlock_session,
            engine_auth_change_password,
            engine_peers_status,
            engine_peers_scan,
            engine_peers_add_manual_peer,
            engine_peers_list_manual_peers,
            engine_peers_request_pairing,
            engine_peers_approve_pairing,
            engine_peers_revoke_device,
            engine_peers_list_peers,
            engine_peers_fingerprint,
            engine_peers_ping_peer,
            engine_sync_create_op,
            engine_sync_objects,
            engine_sync_jobs,
            engine_sync_retry_job,
            engine_sync_cancel_job,
            engine_sync_pull,
            engine_conflicts_list,
            engine_conflicts_get,
            engine_conflicts_resolve,
            engine_conflicts_defer,
            engine_packages_import_package,
            engine_packages_student_view,
            engine_packages_full_view,
            engine_packages_content_hash,
            engine_attempts_start_attempt,
            engine_attempts_save_answer,
            engine_attempts_finalize_attempt,
            engine_attempts_get_attempt,
            engine_attempts_finalized_attempts,
            engine_licensing_activation_request,
            engine_licensing_import_activation,
            engine_licensing_status,
            engine_licensing_entitlements,
            engine_licensing_feature_available,
            engine_backups_create,
            engine_backups_verify,
            engine_backups_list,
            engine_updates_import_update,
            engine_updates_stage,
            engine_updates_mark_applied,
            engine_updates_mark_rejected,
            engine_updates_history,
            engine_audit_query,
            engine_audit_verify_chain,
            engine_diagnostics_status,
            engine_events_recent,
        ])
        .build(tauri::generate_context!())
        .expect("failed to initialize the XamVerse desktop runtime");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
            if let Some(lifecycle) = handle.try_state::<Lifecycle>() {
                let _ = lifecycle.browser_shutdown.send(true);
            }
            if let Some(state) = handle.try_state::<DesktopState>() {
                tauri::async_runtime::block_on(state.engine.stop());
            }
        }
    });
}

fn configured_keys(value: Option<&'static str>) -> Vec<String> {
    value
        .into_iter()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "XamVerse Device".to_string())
}

fn browser_frontend_dir(app: &tauri::App) -> Option<std::path::PathBuf> {
    let installed = app.path().resource_dir().ok()?.join("frontend-dist");
    if installed.join("index.html").is_file() {
        return Some(installed);
    }
    let development = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("frontend-dist");
    development
        .join("index.html")
        .is_file()
        .then_some(development)
}
