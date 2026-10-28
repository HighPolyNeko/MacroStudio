//! Горячие клавиши и запуск макросов в фоне.
//!
//! Раз в несколько миллисекунд опрашивает состояние клавиш и по режиму макроса
//! (toggle / hold / once) запускает или останавливает его.
//! Клавиша аварийной остановки (`Pause`) останавливает все макросы.

use crate::engine::{execute, StopFlag};
use crate::input::{InputBackend, KeyReader};
use crate::keys;
use crate::model::{MacroDef, TriggerMode};
use crate::program::{compile, Program};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub const PANIC_KEY: &str = "Pause";
const POLL_MS: u64 = 5;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusEvent {
    pub id: String,
    pub running: bool,
    pub error: Option<String>,
}

/// Результат проверки макроса при загрузке в движок.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MacroReport {
    pub id: String,
    pub error: Option<String>,
}

pub type StatusCallback = Arc<dyn Fn(StatusEvent) + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TriggerAction {
    Nothing,
    Start,
    Stop,
}

/// Превращает состояние клавиши (нажата / нет) в команды запуска и остановки.
#[derive(Default)]
pub struct Tracker {
    prev: bool,
}

impl Tracker {
    pub fn update(&mut self, mode: TriggerMode, down: bool, running: bool) -> TriggerAction {
        let rising = down && !self.prev;
        let falling = !down && self.prev;
        self.prev = down;
        match mode {
            TriggerMode::Toggle if rising => {
                if running {
                    TriggerAction::Stop
                } else {
                    TriggerAction::Start
                }
            }
            TriggerMode::Hold if rising && !running => TriggerAction::Start,
            TriggerMode::Hold if falling && running => TriggerAction::Stop,
            TriggerMode::Once if rising && !running => TriggerAction::Start,
            _ => TriggerAction::Nothing,
        }
    }
}

struct Entry {
    id: String,
    program: Arc<Program>,
    trigger: Option<u16>,
    mode: TriggerMode,
    enabled: bool,
    tracker: Tracker,
    stop: StopFlag,
    running: Arc<AtomicBool>,
}

struct Inner {
    input: Arc<dyn InputBackend>,
    keys: Arc<dyn KeyReader>,
    on_status: StatusCallback,
    entries: Mutex<HashMap<String, Entry>>,
    shutdown: AtomicBool,
}

impl Inner {
    fn start_entry(&self, e: &mut Entry) {
        if e.running.swap(true, Ordering::SeqCst) {
            return; // уже работает
        }
        e.stop.reset();
        (self.on_status)(StatusEvent {
            id: e.id.clone(),
            running: true,
            error: None,
        });
        let program = e.program.clone();
        let stop = e.stop.clone();
        let running = e.running.clone();
        let input = self.input.clone();
        let on_status = self.on_status.clone();
        let id = e.id.clone();
        let repeat = e.mode != TriggerMode::Once;
        thread::spawn(move || {
            let mut error = None;
            loop {
                if let Err(err) = execute(&program, &*input, &stop) {
                    error = Some(err);
                    break;
                }
                if !repeat || stop.is_stopped() {
                    break;
                }
                thread::sleep(Duration::from_millis(1));
            }
            running.store(false, Ordering::SeqCst);
            on_status(StatusEvent {
                id,
                running: false,
                error,
            });
        });
    }

    fn stop_all(&self) {
        for e in self.entries.lock().unwrap().values() {
            e.stop.stop();
        }
    }

    fn poll_loop(self: Arc<Self>) {
        let panic_vk = keys::parse_key(PANIC_KEY).expect("panic key");
        let mut panic_prev = false;
        while !self.shutdown.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(POLL_MS));
            let panic_now = self.keys.is_down(panic_vk);
            if panic_now && !panic_prev {
                self.stop_all();
            }
            panic_prev = panic_now;

            let mut map = self.entries.lock().unwrap();
            for e in map.values_mut() {
                let Some(vk) = e.trigger else { continue };
                if !e.enabled {
                    continue;
                }
                let down = self.keys.is_down(vk);
                match e.tracker.update(e.mode, down, e.running.load(Ordering::SeqCst)) {
                    TriggerAction::Start => self.start_entry(e),
                    TriggerAction::Stop => e.stop.stop(),
                    TriggerAction::Nothing => {}
                }
            }
        }
    }
}

pub struct Hub {
    inner: Arc<Inner>,
}

impl Hub {
    pub fn new(
        input: Arc<dyn InputBackend>,
        keys: Arc<dyn KeyReader>,
        on_status: StatusCallback,
    ) -> Self {
        let inner = Arc::new(Inner {
            input,
            keys,
            on_status,
            entries: Mutex::new(HashMap::new()),
            shutdown: AtomicBool::new(false),
        });
        let worker = inner.clone();
        thread::spawn(move || worker.poll_loop());
        Hub { inner }
    }

    /// Заменяет набор макросов. Все запущенные макросы при этом останавливаются.
    /// Невалидные макросы не загружаются, причина возвращается в отчёте.
    pub fn set_macros(&self, defs: Vec<MacroDef>) -> Vec<MacroReport> {
        self.inner.stop_all();
        let mut reports = Vec::new();
        let mut map = HashMap::new();
        for def in defs {
            let trigger = if def.trigger.key.trim().is_empty() {
                Ok(None)
            } else {
                keys::parse_trigger(&def.trigger.key)
                    .map(Some)
                    .ok_or_else(|| format!("неизвестная горячая клавиша «{}»", def.trigger.key))
            };
            let result = compile(&def)
                .map_err(|errs| errs.join("; "))
                .and_then(|p| trigger.map(|t| (p, t)));
            match result {
                Ok((program, trigger)) => {
                    reports.push(MacroReport {
                        id: def.id.clone(),
                        error: None,
                    });
                    map.insert(
                        def.id.clone(),
                        Entry {
                            id: def.id,
                            program: Arc::new(program),
                            trigger,
                            mode: def.trigger.mode,
                            enabled: def.enabled,
                            tracker: Tracker::default(),
                            stop: StopFlag::new(),
                            running: Arc::new(AtomicBool::new(false)),
                        },
                    );
                }
                Err(error) => reports.push(MacroReport {
                    id: def.id,
                    error: Some(error),
                }),
            }
        }
        *self.inner.entries.lock().unwrap() = map;
        reports
    }

    /// Запуск кнопкой в окне (так же, как по горячей клавише).
    pub fn start(&self, id: &str) {
        let mut map = self.inner.entries.lock().unwrap();
        if let Some(e) = map.get_mut(id) {
            self.inner.start_entry(e);
        }
    }

    pub fn stop(&self, id: &str) {
        if let Some(e) = self.inner.entries.lock().unwrap().get(id) {
            e.stop.stop();
        }
    }

    pub fn stop_all(&self) {
        self.inner.stop_all();
    }

    pub fn is_running(&self, id: &str) -> bool {
        self.inner
            .entries
            .lock()
            .unwrap()
            .get(id)
            .map(|e| e.running.load(Ordering::SeqCst))
            .unwrap_or(false)
    }
}

impl Drop for Hub {
    fn drop(&mut self) {
        self.inner.stop_all();
        self.inner.shutdown.store(true, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::{Event, ManualKeys, RecordingInput};
    use crate::testutil::def_with_trigger;
    use serde_json::json;

    #[test]
    fn tracker_toggle() {
        let mut t = Tracker::default();
        use TriggerAction::*;
        assert_eq!(t.update(TriggerMode::Toggle, false, false), Nothing);
        assert_eq!(t.update(TriggerMode::Toggle, true, false), Start);
        assert_eq!(t.update(TriggerMode::Toggle, true, true), Nothing); // держим — не дребезжит
        assert_eq!(t.update(TriggerMode::Toggle, false, true), Nothing);
        assert_eq!(t.update(TriggerMode::Toggle, true, true), Stop);
    }

    #[test]
    fn tracker_hold() {
        let mut t = Tracker::default();
        use TriggerAction::*;
        assert_eq!(t.update(TriggerMode::Hold, true, false), Start);
        assert_eq!(t.update(TriggerMode::Hold, true, true), Nothing);
        assert_eq!(t.update(TriggerMode::Hold, false, true), Stop);
        assert_eq!(t.update(TriggerMode::Hold, false, false), Nothing);
    }

    #[test]
    fn tracker_once() {
        let mut t = Tracker::default();
        use TriggerAction::*;
        assert_eq!(t.update(TriggerMode::Once, true, false), Start);
        assert_eq!(t.update(TriggerMode::Once, true, true), Nothing);
        assert_eq!(t.update(TriggerMode::Once, false, false), Nothing);
        assert_eq!(t.update(TriggerMode::Once, true, true), Nothing); // ещё работает — игнор
    }

    fn simple_macro(mode: &str) -> MacroDef {
        def_with_trigger(
            "F6",
            mode,
            json!([
                {"id":"s","type":"start","position":{"x":0,"y":0},"data":{}},
                {"id":"a","type":"key","position":{"x":0,"y":0},"data":{"key":"A","action":"press","holdMs":1}},
                {"id":"d","type":"delay","position":{"x":0,"y":0},"data":{"ms":5}}
            ]),
            json!([{"id":"1","source":"s","target":"a"},{"id":"2","source":"a","target":"d"}]),
        )
    }

    fn setup(mode: &str) -> (Hub, Arc<RecordingInput>, Arc<ManualKeys>) {
        let input = Arc::new(RecordingInput::default());
        let keys = Arc::new(ManualKeys::default());
        let hub = Hub::new(input.clone(), keys.clone(), Arc::new(|_| {}));
        let reports = hub.set_macros(vec![simple_macro(mode)]);
        assert_eq!(reports[0].error, None);
        (hub, input, keys)
    }

    fn a_presses(input: &RecordingInput) -> usize {
        input
            .events()
            .iter()
            .filter(|e| **e == Event::Key { vk: 0x41, down: true })
            .count()
    }

    #[test]
    fn hold_mode_runs_only_while_pressed() {
        let (hub, input, keys) = setup("hold");
        keys.set(0x75, true); // F6
        thread::sleep(Duration::from_millis(150));
        assert!(hub.is_running("m1"));
        assert!(a_presses(&input) >= 3);
        keys.set(0x75, false);
        thread::sleep(Duration::from_millis(100));
        assert!(!hub.is_running("m1"));
        let n = a_presses(&input);
        thread::sleep(Duration::from_millis(60));
        assert_eq!(a_presses(&input), n);
    }

    #[test]
    fn toggle_mode_on_and_off() {
        let (hub, input, keys) = setup("toggle");
        keys.set(0x75, true);
        thread::sleep(Duration::from_millis(30));
        keys.set(0x75, false);
        thread::sleep(Duration::from_millis(120));
        assert!(hub.is_running("m1"));
        assert!(a_presses(&input) >= 3);
        keys.set(0x75, true);
        thread::sleep(Duration::from_millis(30));
        keys.set(0x75, false);
        thread::sleep(Duration::from_millis(80));
        assert!(!hub.is_running("m1"));
    }

    #[test]
    fn once_mode_runs_single_pass() {
        let (hub, input, keys) = setup("once");
        keys.set(0x75, true);
        thread::sleep(Duration::from_millis(30));
        keys.set(0x75, false);
        thread::sleep(Duration::from_millis(150));
        assert!(!hub.is_running("m1"));
        assert_eq!(a_presses(&input), 1);
    }

    #[test]
    fn panic_key_stops_everything() {
        let (hub, _input, keys) = setup("toggle");
        keys.set(0x75, true);
        thread::sleep(Duration::from_millis(30));
        keys.set(0x75, false);
        thread::sleep(Duration::from_millis(60));
        assert!(hub.is_running("m1"));
        keys.set(0x13, true); // Pause
        thread::sleep(Duration::from_millis(80));
        assert!(!hub.is_running("m1"));
    }

    #[test]
    fn invalid_macro_is_reported_not_loaded() {
        let input = Arc::new(RecordingInput::default());
        let hub = Hub::new(input, Arc::new(ManualKeys::default()), Arc::new(|_| {}));
        let bad = def_with_trigger("F6", "once", json!([]), json!([]));
        let reports = hub.set_macros(vec![bad]);
        assert!(reports[0].error.as_deref().unwrap().contains("Старт"));
    }

    #[test]
    fn unknown_trigger_key_is_reported() {
        let input = Arc::new(RecordingInput::default());
        let hub = Hub::new(input, Arc::new(ManualKeys::default()), Arc::new(|_| {}));
        let mut m = simple_macro("once");
        m.trigger.key = "Bogus".into();
        let reports = hub.set_macros(vec![m]);
        assert!(reports[0].error.as_deref().unwrap().contains("Bogus"));
    }
}
