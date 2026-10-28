//! Имена клавиш → виртуальные коды Windows (VK).

fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace() && *c != '_' && *c != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

const NAMED: &[(&str, u16)] = &[
    ("backspace", 0x08),
    ("tab", 0x09),
    ("enter", 0x0D),
    ("return", 0x0D),
    ("shift", 0x10),
    ("ctrl", 0x11),
    ("control", 0x11),
    ("alt", 0x12),
    ("pause", 0x13),
    ("capslock", 0x14),
    ("esc", 0x1B),
    ("escape", 0x1B),
    ("space", 0x20),
    ("pageup", 0x21),
    ("pagedown", 0x22),
    ("end", 0x23),
    ("home", 0x24),
    ("left", 0x25),
    ("up", 0x26),
    ("right", 0x27),
    ("down", 0x28),
    ("printscreen", 0x2C),
    ("insert", 0x2D),
    ("delete", 0x2E),
    ("del", 0x2E),
    ("win", 0x5B),
    ("lwin", 0x5B),
    ("rwin", 0x5C),
    ("numpadmultiply", 0x6A),
    ("numpadadd", 0x6B),
    ("numpadsubtract", 0x6D),
    ("numpaddecimal", 0x6E),
    ("numpaddivide", 0x6F),
    ("numlock", 0x90),
    ("scrolllock", 0x91),
    ("lshift", 0xA0),
    ("rshift", 0xA1),
    ("lctrl", 0xA2),
    ("rctrl", 0xA3),
    ("lalt", 0xA4),
    ("ralt", 0xA5),
    ("semicolon", 0xBA),
    ("equals", 0xBB),
    ("comma", 0xBC),
    ("minus", 0xBD),
    ("period", 0xBE),
    ("slash", 0xBF),
    ("backtick", 0xC0),
    ("lbracket", 0xDB),
    ("backslash", 0xDC),
    ("rbracket", 0xDD),
    ("quote", 0xDE),
];

/// Клавиатурная клавиша по имени («A», «F5», «Ctrl», «Numpad7», «Space» …).
pub fn parse_key(name: &str) -> Option<u16> {
    let n = normalize(name);
    if n.is_empty() {
        return None;
    }
    if n.len() == 1 {
        let c = n.as_bytes()[0];
        if c.is_ascii_lowercase() {
            return Some(0x41 + (c - b'a') as u16);
        }
        if c.is_ascii_digit() {
            return Some(0x30 + (c - b'0') as u16);
        }
    }
    if let Some(rest) = n.strip_prefix('f') {
        if let Ok(k) = rest.parse::<u16>() {
            if (1..=24).contains(&k) {
                return Some(0x6F + k);
            }
        }
    }
    if let Some(rest) = n.strip_prefix("numpad") {
        if rest.len() == 1 && rest.as_bytes()[0].is_ascii_digit() {
            return Some(0x60 + (rest.as_bytes()[0] - b'0') as u16);
        }
    }
    NAMED.iter().find(|(k, _)| *k == n).map(|(_, vk)| *vk)
}

/// Клавиша для горячей клавиши запуска: клавиатура + средняя/боковые кнопки мыши.
pub fn parse_trigger(name: &str) -> Option<u16> {
    match normalize(name).as_str() {
        "mouse3" | "mbutton" => Some(0x04),
        "mouse4" => Some(0x05),
        "mouse5" => Some(0x06),
        _ => parse_key(name),
    }
}

/// Нужен ли флаг EXTENDEDKEY при отправке (стрелки, Home/End, правые Ctrl/Alt и т.п.).
pub fn is_extended(vk: u16) -> bool {
    matches!(
        vk,
        0x21..=0x28 | 0x2C | 0x2D | 0x2E | 0x5B | 0x5C | 0x6F | 0x90 | 0xA3 | 0xA5
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_keys() {
        assert_eq!(parse_key("A"), Some(0x41));
        assert_eq!(parse_key("z"), Some(0x5A));
        assert_eq!(parse_key("0"), Some(0x30));
        assert_eq!(parse_key("F1"), Some(0x70));
        assert_eq!(parse_key("f12"), Some(0x7B));
        assert_eq!(parse_key("F24"), Some(0x87));
        assert_eq!(parse_key("Numpad7"), Some(0x67));
        assert_eq!(parse_key("Ctrl"), Some(0x11));
        assert_eq!(parse_key("Space"), Some(0x20));
        assert_eq!(parse_key("Page Up"), Some(0x21));
    }

    #[test]
    fn rejects_unknown() {
        assert_eq!(parse_key(""), None);
        assert_eq!(parse_key("F25"), None);
        assert_eq!(parse_key("nope"), None);
        assert_eq!(parse_key("Mouse4"), None); // мышь — только для триггера
    }

    #[test]
    fn trigger_accepts_mouse_buttons() {
        assert_eq!(parse_trigger("Mouse4"), Some(0x05));
        assert_eq!(parse_trigger("Mouse3"), Some(0x04));
        assert_eq!(parse_trigger("F6"), Some(0x75));
    }

    #[test]
    fn extended_flags() {
        assert!(is_extended(0x25)); // Left
        assert!(!is_extended(0x41)); // A
    }
}
