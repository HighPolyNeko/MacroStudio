//! Формат макроса (он же JSON для экспорта/импорта).
//!
//! Узлы и связи повторяют формат React Flow: `{ id, type, position, data }`.

use serde::{Deserialize, Serialize};

pub const FORMAT_VERSION: u32 = 1;

fn default_version() -> u32 {
    FORMAT_VERSION
}
fn default_true() -> bool {
    true
}
fn default_hold_ms() -> u64 {
    30
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TriggerMode {
    /// Нажал — работает, нажал ещё раз — остановился.
    Toggle,
    /// Работает, пока кнопка зажата.
    Hold,
    /// Одно нажатие — один прогон макроса.
    Once,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Trigger {
    /// Пустая строка — горячей клавиши нет (запуск только кнопкой в окне).
    #[serde(default)]
    pub key: String,
    pub mode: TriggerMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Button {
    Left,
    Right,
    Middle,
    X1,
    X2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyAction {
    /// Нажать и отпустить.
    #[default]
    Press,
    Down,
    Up,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ButtonAction {
    #[default]
    Click,
    Down,
    Up,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    content = "data",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Action {
    Start {},
    Key {
        key: String,
        #[serde(default)]
        action: KeyAction,
        /// Сколько держать клавишу при «нажать и отпустить».
        #[serde(default = "default_hold_ms")]
        hold_ms: u64,
    },
    Mouse {
        button: Button,
        #[serde(default)]
        action: ButtonAction,
        #[serde(default = "default_hold_ms")]
        hold_ms: u64,
    },
    MouseMove {
        x: i32,
        y: i32,
        /// true — сдвиг от текущей позиции, false — абсолютные координаты экрана.
        #[serde(default)]
        relative: bool,
    },
    /// Положительное число — прокрутка вверх, отрицательное — вниз (в «щелчках» колеса).
    Scroll { amount: i32 },
    Delay {
        ms: u64,
        /// Случайная добавка 0..=jitter_ms к задержке.
        #[serde(default)]
        jitter_ms: u64,
    },
    /// Повторяет цепочку из выхода `body` count раз (0 — бесконечно), затем идёт в `next`.
    Loop { count: u32 },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    #[serde(default)]
    pub position: Position,
    #[serde(flatten)]
    pub action: Action,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    #[serde(default)]
    pub id: String,
    pub source: String,
    pub target: String,
    /// `next` (по умолчанию) или `body` (только у узла цикла).
    #[serde(default)]
    pub source_handle: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroDef {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub trigger: Trigger,
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub edges: Vec<Edge>,
}
