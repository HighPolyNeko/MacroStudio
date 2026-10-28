//! Ядро Macro Studio: формат макроса, проверка, выполнение, горячие клавиши.
//! Не зависит от Tauri — тесты гоняются на любой ОС.

pub mod engine;
pub mod hub;
pub mod input;
pub mod keys;
pub mod model;
pub mod program;
#[cfg(windows)]
pub mod win;

use input::{InputBackend, KeyReader};
use std::sync::Arc;

/// Ввод и чтение клавиш для текущей платформы.
/// Не-Windows: заглушки (интерфейс работает, события не отправляются).
#[cfg(windows)]
pub fn platform_backends() -> (Arc<dyn InputBackend>, Arc<dyn KeyReader>) {
    (Arc::new(win::WindowsInput), Arc::new(win::WindowsKeys))
}

#[cfg(not(windows))]
pub fn platform_backends() -> (Arc<dyn InputBackend>, Arc<dyn KeyReader>) {
    (Arc::new(input::NullInput), Arc::new(input::NullKeys))
}

/// Прямоугольник всех мониторов: (x, y, ширина, высота) в физических пикселях.
#[cfg(windows)]
pub fn virtual_screen() -> (i32, i32, i32, i32) {
    win::virtual_screen()
}

#[cfg(not(windows))]
pub fn virtual_screen() -> (i32, i32, i32, i32) {
    (0, 0, 1920, 1080)
}

/// Позиция курсора на экране (None, если узнать не удалось).
#[cfg(windows)]
pub fn cursor_pos() -> Option<(i32, i32)> {
    win::cursor_pos()
}

#[cfg(not(windows))]
pub fn cursor_pos() -> Option<(i32, i32)> {
    None
}

#[cfg(test)]
pub mod testutil {
    use crate::model::MacroDef;
    use crate::program::{compile, Program};
    use serde_json::{json, Value};

    pub fn def_with_trigger(key: &str, mode: &str, nodes: Value, edges: Value) -> MacroDef {
        serde_json::from_value(json!({
            "id": "m1",
            "name": "test",
            "trigger": { "key": key, "mode": mode },
            "nodes": nodes,
            "edges": edges
        }))
        .expect("test macro must deserialize")
    }

    pub fn def(nodes: Value, edges: Value) -> MacroDef {
        def_with_trigger("F6", "once", nodes, edges)
    }

    pub fn prog(nodes: Value, edges: Value) -> Program {
        compile(&def(nodes, edges)).expect("test macro must compile")
    }
}
