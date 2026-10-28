// KeyboardEvent.code (браузер) -> имя клавиши, которое понимает ядро (macro-core/src/keys.rs)

const MAP: Record<string, string> = {
  ControlLeft: 'LCtrl',
  ControlRight: 'RCtrl',
  ShiftLeft: 'LShift',
  ShiftRight: 'RShift',
  AltLeft: 'LAlt',
  AltRight: 'RAlt',
  MetaLeft: 'LWin',
  MetaRight: 'RWin',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Backspace',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End',
  Insert: 'Insert',
  Delete: 'Delete',
  CapsLock: 'CapsLock',
  NumLock: 'NumLock',
  ScrollLock: 'ScrollLock',
  Pause: 'Pause',
  PrintScreen: 'PrintScreen',
  Semicolon: 'Semicolon',
  Equal: 'Equals',
  Comma: 'Comma',
  Minus: 'Minus',
  Period: 'Period',
  Slash: 'Slash',
  Backquote: 'Backtick',
  BracketLeft: 'LBracket',
  Backslash: 'Backslash',
  BracketRight: 'RBracket',
  Quote: 'Quote',
  NumpadMultiply: 'NumpadMultiply',
  NumpadAdd: 'NumpadAdd',
  NumpadSubtract: 'NumpadSubtract',
  NumpadDecimal: 'NumpadDecimal',
  NumpadDivide: 'NumpadDivide',
};

export function codeToName(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^F(\d{1,2})$/.exec(code);
  if (m && +m[1] >= 1 && +m[1] <= 24) return `F${m[1]}`;
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Numpad${m[1]}`;
  return MAP[code] ?? null;
}

export function mouseButtonToName(button: number): string | null {
  if (button === 1) return 'Mouse3';
  if (button === 3) return 'Mouse4';
  if (button === 4) return 'Mouse5';
  return null;
}
