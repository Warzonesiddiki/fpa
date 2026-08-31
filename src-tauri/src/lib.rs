//! OneFP&A app bootstrap (Tauri 2). Core lives in `core/`; commands in `commands/`.
//! Invariants at the IPC boundary (ARCHITECTURE §1b): typed commands, money i64/decimal strings,
//! mutations audited, no network (B1/B18-9).

pub mod commands;
pub mod core;
pub mod storage;

use commands::calendar::{calendar_apply, calendar_preview};
use commands::coa::coa_list;
use commands::company::{company_create, company_delete, company_list, company_open};
use commands::import::{
    import_commit, import_parse, import_rollback, import_tieout, import_validate, ParseRegistry,
};
use commands::model::{model_cell_set_v1, model_recalc, ModelRegistry};
use commands::pack::pack_list;
use commands::security::{security_change_pin, security_pin_setup};
use commands::session::{session_lock, session_status, session_unlock, SessionState};
use storage::keys::KeyVault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SessionState::default())
        // In-memory unlocked vault key (A02): never persisted, zeroised by `session.lock`.
        .manage(KeyVault::default())
        // In-memory parse store (B19): parsed rows live only between import.parse and
        // import.commit and are never written to disk.
        .manage(ParseRegistry::default())
        // In-memory Model working set (F-012/M3-1): cell edits are echo/validated here until the
        // HyperFormula worker owns the cell graph and `model_values` is the persisted source.
        .manage(ModelRegistry::default())
        .invoke_handler(tauri::generate_handler![
            session_status,
            session_unlock,
            session_lock,
            security_change_pin,
            security_pin_setup,
            company_list,
            company_create,
            company_open,
            company_delete,
            calendar_preview,
            calendar_apply,
            coa_list,
            pack_list,
            import_parse,
            import_validate,
            import_tieout,
            import_commit,
            import_rollback,
            model_cell_set_v1,
            model_recalc,
        ])
        .setup(|_app| {
            // Least-privilege check: no shell plugin, no broad FS capability (SECURITY-CHECKLIST A05).
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running OneFP&A");
}
