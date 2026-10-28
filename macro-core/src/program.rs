//! Проверка и «компиляция» графа в удобную для выполнения структуру.

use crate::keys;
use crate::model::{Action, MacroDef};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Port {
    Next,
    Body,
}

#[derive(Debug, Default, Clone)]
struct Links {
    next: Option<String>,
    body: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Program {
    pub start: String,
    pub nodes: HashMap<String, Action>,
    links: HashMap<String, Links>,
}

impl Program {
    pub fn next_of(&self, id: &str, port: Port) -> Option<&str> {
        let l = self.links.get(id)?;
        match port {
            Port::Next => l.next.as_deref(),
            Port::Body => l.body.as_deref(),
        }
    }
}

fn has_cycle(id: &str, links: &HashMap<String, Links>, color: &mut HashMap<String, u8>) -> bool {
    match color.get(id) {
        Some(1) => return true,
        Some(2) => return false,
        _ => {}
    }
    color.insert(id.to_string(), 1);
    if let Some(l) = links.get(id) {
        for t in [&l.next, &l.body].into_iter().flatten() {
            if has_cycle(t, links, color) {
                return true;
            }
        }
    }
    color.insert(id.to_string(), 2);
    false
}

/// Возвращает программу или список понятных ошибок (по-русски, для показа в интерфейсе).
pub fn compile(def: &MacroDef) -> Result<Program, Vec<String>> {
    let mut errs: Vec<String> = Vec::new();
    let mut nodes: HashMap<String, Action> = HashMap::new();
    let mut start: Option<String> = None;

    for n in &def.nodes {
        if nodes.insert(n.id.clone(), n.action.clone()).is_some() {
            errs.push(format!("повторяется id узла «{}»", n.id));
        }
        match &n.action {
            Action::Start {} => {
                if start.is_some() {
                    errs.push("в макросе больше одного узла «Старт»".into());
                } else {
                    start = Some(n.id.clone());
                }
            }
            Action::Key { key, .. } => {
                if keys::parse_key(key).is_none() {
                    errs.push(format!("неизвестная клавиша «{key}»"));
                }
            }
            _ => {}
        }
    }
    if start.is_none() {
        errs.push("нет узла «Старт»".into());
    }

    let mut links: HashMap<String, Links> = HashMap::new();
    for e in &def.edges {
        let Some(src) = nodes.get(&e.source) else {
            errs.push(format!("связь из несуществующего узла «{}»", e.source));
            continue;
        };
        let Some(dst) = nodes.get(&e.target) else {
            errs.push(format!("связь в несуществующий узел «{}»", e.target));
            continue;
        };
        if matches!(dst, Action::Start {}) {
            errs.push("в узел «Старт» нельзя вести связь".into());
            continue;
        }
        let port = match e.source_handle.as_deref() {
            None | Some("next") => Port::Next,
            Some("body") => {
                if !matches!(src, Action::Loop { .. }) {
                    errs.push("выход «тело» есть только у узла «Цикл»".into());
                    continue;
                }
                Port::Body
            }
            Some(other) => {
                errs.push(format!("неизвестный выход «{other}»"));
                continue;
            }
        };
        let l = links.entry(e.source.clone()).or_default();
        let slot = match port {
            Port::Next => &mut l.next,
            Port::Body => &mut l.body,
        };
        if slot.is_some() {
            errs.push(format!(
                "из узла «{}» выходит больше одной связи из одного выхода",
                e.source
            ));
        } else {
            *slot = Some(e.target.clone());
        }
    }

    if let Some(s) = &start {
        let mut color = HashMap::new();
        if has_cycle(s, &links, &mut color) {
            errs.push("в схеме есть замкнутый круг — для повторов используйте узел «Цикл»".into());
        }
    }

    if !errs.is_empty() {
        return Err(errs);
    }
    Ok(Program {
        start: start.unwrap(),
        nodes,
        links,
    })
}

#[cfg(test)]
mod tests {
    use crate::testutil::{def, prog};
    use serde_json::json;

    fn start() -> serde_json::Value {
        json!({"id":"s","type":"start","position":{"x":0,"y":0},"data":{}})
    }
    fn key(id: &str, k: &str) -> serde_json::Value {
        json!({"id":id,"type":"key","position":{"x":0,"y":0},"data":{"key":k,"action":"press","holdMs":1}})
    }
    fn edge(id: &str, s: &str, t: &str) -> serde_json::Value {
        json!({"id":id,"source":s,"target":t})
    }

    #[test]
    fn ok_simple_chain() {
        let p = prog(json!([start(), key("a", "A")]), json!([edge("e", "s", "a")]));
        assert_eq!(p.start, "s");
    }

    #[test]
    fn react_flow_extra_fields_are_ignored() {
        let nodes = json!([
            {"id":"s","type":"start","position":{"x":1.5,"y":2},"data":{},"selected":true,"measured":{"width":10,"height":10}},
        ]);
        let d = def(nodes, json!([]));
        assert!(crate::program::compile(&d).is_ok());
    }

    #[test]
    fn needs_start() {
        let d = def(json!([key("a", "A")]), json!([]));
        let e = crate::program::compile(&d).unwrap_err();
        assert!(e.iter().any(|m| m.contains("Старт")));
    }

    #[test]
    fn rejects_two_starts() {
        let s2 = json!({"id":"s2","type":"start","position":{"x":0,"y":0},"data":{}});
        let d = def(json!([start(), s2]), json!([]));
        assert!(crate::program::compile(&d).is_err());
    }

    #[test]
    fn rejects_bad_key() {
        let d = def(json!([start(), key("a", "Nope")]), json!([edge("e", "s", "a")]));
        let e = crate::program::compile(&d).unwrap_err();
        assert!(e.iter().any(|m| m.contains("Nope")));
    }

    #[test]
    fn rejects_cycle() {
        let d = def(
            json!([start(), key("a", "A"), key("b", "B")]),
            json!([edge("1", "s", "a"), edge("2", "a", "b"), edge("3", "b", "a")]),
        );
        let e = crate::program::compile(&d).unwrap_err();
        assert!(e.iter().any(|m| m.contains("замкнутый")));
    }

    #[test]
    fn rejects_two_edges_from_one_output() {
        let d = def(
            json!([start(), key("a", "A"), key("b", "B")]),
            json!([edge("1", "s", "a"), edge("2", "s", "b")]),
        );
        assert!(crate::program::compile(&d).is_err());
    }

    #[test]
    fn body_handle_only_on_loop() {
        let d = def(
            json!([start(), key("a", "A")]),
            json!([{"id":"1","source":"s","target":"a","sourceHandle":"body"}]),
        );
        assert!(crate::program::compile(&d).is_err());
    }

    #[test]
    fn null_source_handle_is_next() {
        let d = def(
            json!([start(), key("a", "A")]),
            json!([{"id":"1","source":"s","target":"a","sourceHandle":null}]),
        );
        assert!(crate::program::compile(&d).is_ok());
    }
}
