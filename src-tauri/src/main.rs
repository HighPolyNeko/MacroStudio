#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use macro_core::hub::{Hub, MacroReport, StatusEvent};
use macro_core::model::MacroDef;
use macro_core::platform_backends;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

struct AppState {
    hub: Hub,
}

/// Загружает набор макросов в движок. Возвращает по каждому макросу ошибку проверки (или null).
#[tauri::command]
fn apply_macros(state: State<AppState>, macros: Vec<MacroDef>) -> Vec<MacroReport> {
    state.hub.set_macros(macros)
}

#[tauri::command]
fn start_macro(state: State<AppState>, id: String) {
    state.hub.start(&id);
}

#[tauri::command]
fn stop_macro(state: State<AppState>, id: String) {
    state.hub.stop(&id);
}

#[tauri::command]
fn stop_all(state: State<AppState>) {
    state.hub.stop_all();
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("не удалось прочитать файл: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("не удалось записать файл: {e}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let (input, keys) = platform_backends();
            let hub = Hub::new(
                input,
                keys,
                Arc::new(move |ev: StatusEvent| {
                    let _ = handle.emit("macro-status", ev);
                }),
            );
            app.manage(AppState { hub });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            apply_macros,
            start_macro,
            stop_macro,
            stop_all,
            read_text_file,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("ошибка запуска приложения");
}
