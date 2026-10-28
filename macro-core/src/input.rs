//! Абстракция ввода: настоящая (Windows, `win.rs`), «пустая» и записывающая (для тестов).

use crate::model::Button;
use std::collections::HashSet;
use std::sync::Mutex;

/// Отправка событий мыши и клавиатуры в систему.
pub trait InputBackend: Send + Sync {
    fn key(&self, vk: u16, down: bool) -> Result<(), String>;
    fn mouse_button(&self, button: Button, down: bool) -> Result<(), String>;
    fn mouse_move(&self, x: i32, y: i32, relative: bool) -> Result<(), String>;
    /// Щелчки колеса: > 0 вверх, < 0 вниз.
    fn scroll(&self, notches: i32) -> Result<(), String>;
}

/// Чтение состояния клавиш (для горячих клавиш запуска).
pub trait KeyReader: Send + Sync {
    fn is_down(&self, vk: u16) -> bool;
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Key { vk: u16, down: bool },
    Button { button: Button, down: bool },
    Move { x: i32, y: i32, relative: bool },
    Scroll(i32),
}

/// Запоминает события вместо отправки. Нужен для тестов.
#[derive(Default)]
pub struct RecordingInput {
    events: Mutex<Vec<Event>>,
}

impl RecordingInput {
    pub fn events(&self) -> Vec<Event> {
        self.events.lock().unwrap().clone()
    }
    fn push(&self, e: Event) -> Result<(), String> {
        self.events.lock().unwrap().push(e);
        Ok(())
    }
}

impl InputBackend for RecordingInput {
    fn key(&self, vk: u16, down: bool) -> Result<(), String> {
        self.push(Event::Key { vk, down })
    }
    fn mouse_button(&self, button: Button, down: bool) -> Result<(), String> {
        self.push(Event::Button { button, down })
    }
    fn mouse_move(&self, x: i32, y: i32, relative: bool) -> Result<(), String> {
        self.push(Event::Move { x, y, relative })
    }
    fn scroll(&self, notches: i32) -> Result<(), String> {
        self.push(Event::Scroll(notches))
    }
}

/// Ничего не делает (не-Windows платформы: интерфейс запускается, ввод не отправляется).
pub struct NullInput;

impl InputBackend for NullInput {
    fn key(&self, _: u16, _: bool) -> Result<(), String> {
        Ok(())
    }
    fn mouse_button(&self, _: Button, _: bool) -> Result<(), String> {
        Ok(())
    }
    fn mouse_move(&self, _: i32, _: i32, _: bool) -> Result<(), String> {
        Ok(())
    }
    fn scroll(&self, _: i32) -> Result<(), String> {
        Ok(())
    }
}

pub struct NullKeys;

impl KeyReader for NullKeys {
    fn is_down(&self, _: u16) -> bool {
        false
    }
}

/// Управляемое вручную состояние клавиш. Нужно для тестов.
#[derive(Default)]
pub struct ManualKeys {
    down: Mutex<HashSet<u16>>,
}

impl ManualKeys {
    pub fn set(&self, vk: u16, down: bool) {
        let mut s = self.down.lock().unwrap();
        if down {
            s.insert(vk);
        } else {
            s.remove(&vk);
        }
    }
}

impl KeyReader for ManualKeys {
    fn is_down(&self, vk: u16) -> bool {
        self.down.lock().unwrap().contains(&vk)
    }
}
