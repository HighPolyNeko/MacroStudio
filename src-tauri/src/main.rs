#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use macro_core::hub::{Hub, MacroReport, StatusEvent};
use macro_core::model::MacroDef;
use macro_core::platform_backends;
use serde::Serialize;
use std::sync::Arc;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};

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

const PICKER: &str = "picker";

#[derive(Clone, Serialize)]
struct Point {
    x: i32,
    y: i32,
}

/// Открывает полупрозрачное окно на все мониторы для выбора точки кликом.
/// Результат приходит главному окну событием `point-picked`: точка или null (отмена).
/// Команда async: в Windows создание окна из синхронной команды зависает (особенность Tauri).
#[tauri::command]
async fn start_pick_point(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(PICKER) {
        let _ = w.set_focus();
        return Ok(());
    }
    let (x, y, w, h) = macro_core::virtual_screen();
    let picker = WebviewWindowBuilder::new(&app, PICKER, WebviewUrl::App("index.html".into()))
        .title("Выбор точки")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .build()
        .map_err(|e| format!("не удалось открыть окно выбора точки: {e}"))?;
    let _ = picker.set_position(PhysicalPosition::new(x, y));
    let _ = picker.set_size(PhysicalSize::new(w.max(1) as u32, h.max(1) as u32));

    // Как бы окно ни закрылось (клик, Esc, Alt+F4) — вернуть главное окно и сообщить об отмене.
    // Если точка уже выбрана, событие с ней ушло раньше, и интерфейс это null проигнорирует.
    let handle = app.clone();
    picker.on_window_event(move |ev| {
        if let WindowEvent::Destroyed = ev {
            if let Some(main) = handle.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
            let _ = handle.emit_to("main", "point-picked", None::<Point>);
        }
    });

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.minimize();
    }
    let _ = picker.show();
    let _ = picker.set_focus();
    Ok(())
}

/// Вызывается окном выбора: при клике запоминает позицию курсора, при отмене — нет.
#[tauri::command]
fn finish_pick_point(app: AppHandle, cancel: bool) {
    if !cancel {
        if let Some((x, y)) = macro_core::cursor_pos() {
            let _ = app.emit_to("main", "point-picked", Some(Point { x, y }));
        }
    }
    if let Some(w) = app.get_webview_window(PICKER) {
        let _ = w.close();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            write_text_file,
            start_pick_point,
            finish_pick_point
        ])
        .run(tauri::generate_context!())
        .expect("ошибка запуска приложения");
}
