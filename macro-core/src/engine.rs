//! Выполнение макроса: обход графа, циклы, задержки, остановка.

use crate::input::InputBackend;
use crate::keys;
use crate::model::{Action, Button, ButtonAction, KeyAction};
use crate::program::{Port, Program};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Флаг остановки: его проверяют задержки и переходы между узлами.
#[derive(Clone, Default)]
pub struct StopFlag(Arc<AtomicBool>);

impl StopFlag {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn stop(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn reset(&self) {
        self.0.store(false, Ordering::SeqCst);
    }
    pub fn is_stopped(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

enum Abort {
    Stopped,
    Failed(String),
}

impl From<String> for Abort {
    fn from(s: String) -> Self {
        Abort::Failed(s)
    }
}

struct Ctx<'a> {
    prog: &'a Program,
    input: &'a dyn InputBackend,
    stop: &'a StopFlag,
    held_keys: HashSet<u16>,
    held_buttons: HashSet<Button>,
    rng: u64,
}

impl<'a> Ctx<'a> {
    fn sleep(&self, ms: u64) -> Result<(), Abort> {
        let deadline = Instant::now() + Duration::from_millis(ms);
        loop {
            if self.stop.is_stopped() {
                return Err(Abort::Stopped);
            }
            let now = Instant::now();
            if now >= deadline {
                return Ok(());
            }
            std::thread::sleep((deadline - now).min(Duration::from_millis(5)));
        }
    }

    fn rand(&mut self, max_inclusive: u64) -> u64 {
        // xorshift64
        let mut x = self.rng;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.rng = x;
        x % (max_inclusive + 1)
    }

    fn key_down(&mut self, vk: u16) -> Result<(), Abort> {
        self.input.key(vk, true)?;
        self.held_keys.insert(vk);
        Ok(())
    }
    fn key_up(&mut self, vk: u16) -> Result<(), Abort> {
        self.input.key(vk, false)?;
        self.held_keys.remove(&vk);
        Ok(())
    }
    fn btn_down(&mut self, b: Button) -> Result<(), Abort> {
        self.input.mouse_button(b, true)?;
        self.held_buttons.insert(b);
        Ok(())
    }
    fn btn_up(&mut self, b: Button) -> Result<(), Abort> {
        self.input.mouse_button(b, false)?;
        self.held_buttons.remove(&b);
        Ok(())
    }

    fn release_all(&mut self) {
        for vk in self.held_keys.drain() {
            let _ = self.input.key(vk, false);
        }
        for b in self.held_buttons.drain() {
            let _ = self.input.mouse_button(b, false);
        }
    }

    fn run_chain(&mut self, start: &str) -> Result<(), Abort> {
        let prog = self.prog;
        let mut cur: Option<&str> = Some(start);
        while let Some(id) = cur {
            if self.stop.is_stopped() {
                return Err(Abort::Stopped);
            }
            let action = prog
                .nodes
                .get(id)
                .ok_or_else(|| Abort::Failed(format!("узел «{id}» не найден")))?;
            match action {
                Action::Start {} => {}
                Action::Key {
                    key,
                    action,
                    hold_ms,
                } => {
                    let vk = keys::parse_key(key)
                        .ok_or_else(|| Abort::Failed(format!("неизвестная клавиша «{key}»")))?;
                    match action {
                        KeyAction::Press => {
                            self.key_down(vk)?;
                            self.sleep(*hold_ms)?;
                            self.key_up(vk)?;
                        }
                        KeyAction::Down => self.key_down(vk)?,
                        KeyAction::Up => self.key_up(vk)?,
                    }
                }
                Action::Mouse {
                    button,
                    action,
                    hold_ms,
                } => match action {
                    ButtonAction::Click => {
                        self.btn_down(*button)?;
                        self.sleep(*hold_ms)?;
                        self.btn_up(*button)?;
                    }
                    ButtonAction::Down => self.btn_down(*button)?,
                    ButtonAction::Up => self.btn_up(*button)?,
                },
                Action::MouseMove { x, y, relative } => {
                    self.input.mouse_move(*x, *y, *relative)?;
                }
                Action::Scroll { amount } => {
                    self.input.scroll(*amount)?;
                }
                Action::Delay { ms, jitter_ms } => {
                    let extra = if *jitter_ms > 0 { self.rand(*jitter_ms) } else { 0 };
                    self.sleep(ms + extra)?;
                }
                Action::Loop { count } => {
                    let mut i: u32 = 0;
                    while *count == 0 || i < *count {
                        if let Some(body) = prog.next_of(id, Port::Body) {
                            self.run_chain(body)?;
                        }
                        i = i.saturating_add(1);
                        // маленькая пауза, чтобы пустой бесконечный цикл не грузил процессор
                        self.sleep(1)?;
                    }
                }
            }
            cur = prog.next_of(id, Port::Next);
        }
        Ok(())
    }
}

/// Выполняет программу один раз. Остановка по флагу — не ошибка.
/// В любом случае в конце отпускает все зажатые клавиши и кнопки мыши.
pub fn execute(prog: &Program, input: &dyn InputBackend, stop: &StopFlag) -> Result<(), String> {
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E3779B97F4A7C15)
        | 1;
    let mut ctx = Ctx {
        prog,
        input,
        stop,
        held_keys: HashSet::new(),
        held_buttons: HashSet::new(),
        rng: seed,
    };
    let result = ctx.run_chain(&prog.start);
    ctx.release_all();
    match result {
        Ok(()) | Err(Abort::Stopped) => Ok(()),
        Err(Abort::Failed(e)) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::{Event, RecordingInput};
    use crate::testutil::prog;
    use serde_json::{json, Value};

    fn start() -> Value {
        json!({"id":"s","type":"start","position":{"x":0,"y":0},"data":{}})
    }
    fn key(id: &str, k: &str, action: &str) -> Value {
        json!({"id":id,"type":"key","position":{"x":0,"y":0},"data":{"key":k,"action":action,"holdMs":0}})
    }
    fn lp(id: &str, count: u32) -> Value {
        json!({"id":id,"type":"loop","position":{"x":0,"y":0},"data":{"count":count}})
    }
    fn e(id: &str, s: &str, t: &str, h: Option<&str>) -> Value {
        json!({"id":id,"source":s,"target":t,"sourceHandle":h})
    }
    fn press(vk: u16) -> [Event; 2] {
        [Event::Key { vk, down: true }, Event::Key { vk, down: false }]
    }

    #[test]
    fn simple_sequence() {
        let p = prog(
            json!([
                start(),
                key("a", "A", "press"),
                {"id":"d","type":"delay","position":{"x":0,"y":0},"data":{"ms":5}},
                {"id":"m","type":"mouse","position":{"x":0,"y":0},"data":{"button":"left","action":"click","holdMs":0}},
                {"id":"mv","type":"mouseMove","position":{"x":0,"y":0},"data":{"x":10,"y":-5,"relative":true}},
                {"id":"sc","type":"scroll","position":{"x":0,"y":0},"data":{"amount":-2}}
            ]),
            json!([
                e("1","s","a",None), e("2","a","d",None), e("3","d","m",None),
                e("4","m","mv",None), e("5","mv","sc",None)
            ]),
        );
        let input = RecordingInput::default();
        execute(&p, &input, &StopFlag::new()).unwrap();
        assert_eq!(
            input.events(),
            vec![
                Event::Key { vk: 0x41, down: true },
                Event::Key { vk: 0x41, down: false },
                Event::Button { button: Button::Left, down: true },
                Event::Button { button: Button::Left, down: false },
                Event::Move { x: 10, y: -5, relative: true },
                Event::Scroll(-2),
            ]
        );
    }

    #[test]
    fn loop_runs_body_n_times_then_next() {
        let p = prog(
            json!([start(), lp("l", 3), key("a", "A", "press"), key("b", "B", "press")]),
            json!([e("1","s","l",None), e("2","l","a",Some("body")), e("3","l","b",Some("next"))]),
        );
        let input = RecordingInput::default();
        execute(&p, &input, &StopFlag::new()).unwrap();
        let mut want = Vec::new();
        for _ in 0..3 {
            want.extend(press(0x41));
        }
        want.extend(press(0x42));
        assert_eq!(input.events(), want);
    }

    #[test]
    fn nested_loops() {
        let p = prog(
            json!([
                start(), lp("outer", 2), lp("inner", 3),
                key("a", "A", "press"), key("c", "C", "press")
            ]),
            json!([
                e("1","s","outer",None), e("2","outer","inner",Some("body")),
                e("3","inner","a",Some("body")), e("4","outer","c",Some("next"))
            ]),
        );
        let input = RecordingInput::default();
        execute(&p, &input, &StopFlag::new()).unwrap();
        let ev = input.events();
        let a_downs = ev.iter().filter(|x| **x == Event::Key { vk: 0x41, down: true }).count();
        assert_eq!(a_downs, 6);
        assert_eq!(&ev[ev.len() - 2..], &press(0x43));
    }

    #[test]
    fn empty_loop_body_is_fine() {
        let p = prog(json!([start(), lp("l", 5)]), json!([e("1","s","l",None)]));
        let input = RecordingInput::default();
        execute(&p, &input, &StopFlag::new()).unwrap();
        assert!(input.events().is_empty());
    }

    #[test]
    fn stop_interrupts_infinite_loop_and_releases_held_keys() {
        let p = prog(
            json!([
                start(),
                key("down", "A", "down"),
                lp("l", 0),
                {"id":"d","type":"delay","position":{"x":0,"y":0},"data":{"ms":5}}
            ]),
            json!([e("1","s","down",None), e("2","down","l",None), e("3","l","d",Some("body"))]),
        );
        let input = Arc::new(RecordingInput::default());
        let stop = StopFlag::new();
        let (i2, s2) = (input.clone(), stop.clone());
        let h = std::thread::spawn(move || execute(&p, &*i2, &s2));
        std::thread::sleep(Duration::from_millis(60));
        stop.stop();
        h.join().unwrap().unwrap();
        assert_eq!(
            input.events(),
            vec![
                Event::Key { vk: 0x41, down: true },
                Event::Key { vk: 0x41, down: false }
            ]
        );
    }

    #[test]
    fn delay_with_jitter_waits_at_least_base() {
        let p = prog(
            json!([start(), {"id":"d","type":"delay","position":{"x":0,"y":0},"data":{"ms":20,"jitterMs":10}}]),
            json!([e("1","s","d",None)]),
        );
        let t = Instant::now();
        execute(&p, &RecordingInput::default(), &StopFlag::new()).unwrap();
        assert!(t.elapsed() >= Duration::from_millis(20));
    }
}
