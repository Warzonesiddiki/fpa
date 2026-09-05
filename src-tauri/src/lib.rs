//! OneFP&A app bootstrap (Tauri 2). Core lives in `core/`; commands in `commands/`.
//! Invariants at the IPC boundary (ARCHITECTURE §1b): typed commands, money i64/decimal strings,
//! mutations audited, no network (B1/B18-9).

#![allow(
    clippy::type_complexity,
    clippy::too_many_arguments,
    clippy::doc_lazy_continuation
)]

pub mod commands;
pub mod core;
pub mod storage;

use commands::alerts::{alerts_create_rule, alerts_list};
use commands::assumption::{assumption_find_usages, assumption_list, assumption_upsert};
use commands::audit::audit_list;
use commands::calendar::{calendar_apply, calendar_preview};
use commands::coa::{coa_import, coa_list, coa_merge_accounts};
use commands::company::{
    company_clone_sandbox, company_create, company_delete, company_list, company_open,
};
use commands::cycle::{
    collection_export, collection_import, collection_resolve_conflict, cycle_checklist_status,
    cycle_start, cycle_task_update,
};
use commands::driver::{driver_set_value, driver_upsert};
use commands::fva::fva_get;
use commands::import::{
    ParseRegistry, import_commit, import_history, import_map_save_v1, import_parse,
    import_rollback, import_tieout, import_validate,
};
use commands::license::{license_apply_response, license_request_file, license_verify};
use commands::model::{ModelRegistry, model_cell_set_v1, model_diff, model_recalc};
use commands::pack::pack_list;
use commands::plan::{plan_goal_seek, plan_sensitivity, plan_whatif_overlay};
use commands::scenario::{
    baseline_set, model_list, scenario_approve, scenario_create, scenario_delete,
    scenario_duplicate, scenario_lock, scenario_reopen, scenario_submit,
};
use commands::schedule::model_schedule_upsert;
use commands::security::{security_change_pin, security_pin_setup};
use commands::session::{SessionState, session_lock, session_status, session_unlock};
use commands::settings::{settings_get, settings_set};
use commands::statement::statement_get;
use commands::variance::{variance_get, variance_set_reason_code};
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
            company_clone_sandbox,
            company_delete,
            calendar_preview,
            calendar_apply,
            coa_list,
            coa_import,
            coa_merge_accounts,
            pack_list,
            import_parse,
            import_map_save_v1,
            import_validate,
            import_tieout,
            import_commit,
            import_rollback,
            import_history,
            license_verify,
            license_request_file,
            license_apply_response,
            settings_get,
            settings_set,
            model_cell_set_v1,
            model_recalc,
            model_diff,
            plan_whatif_overlay,
            plan_sensitivity,
            plan_goal_seek,
            driver_upsert,
            driver_set_value,
            assumption_upsert,
            assumption_list,
            assumption_find_usages,
            model_schedule_upsert,
            scenario_create,
            scenario_duplicate,
            scenario_submit,
            scenario_approve,
            scenario_lock,
            scenario_reopen,
            scenario_delete,
            baseline_set,
            model_list,
            cycle_start,
            cycle_task_update,
            cycle_checklist_status,
            collection_export,
            collection_import,
            collection_resolve_conflict,
            variance_get,
            variance_set_reason_code,
            fva_get,
            statement_get,
            alerts_list,
            alerts_create_rule,
            audit_list,
        ])
        .setup(|_app| {
            // Least-privilege check: no shell plugin, no broad FS capability (SECURITY-CHECKLIST A05).
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running OneFP&A");
}
