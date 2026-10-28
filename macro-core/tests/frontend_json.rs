//! Контракт с интерфейсом: JSON, который экспортирует фронтенд, должен читаться и компилироваться ядром.

use macro_core::model::MacroDef;
use macro_core::program::compile;

#[test]
fn frontend_export_is_accepted_by_core() {
    let text = include_str!("fixtures/sample-macro.json");
    let def: MacroDef = serde_json::from_str(text).expect("JSON из интерфейса должен читаться");
    assert_eq!(def.trigger.key, "F6");
    assert!(compile(&def).is_ok());
    // и обратно: ядро пишет JSON, который снова читается
    let again: MacroDef = serde_json::from_str(&serde_json::to_string(&def).unwrap()).unwrap();
    assert_eq!(def, again);
}
