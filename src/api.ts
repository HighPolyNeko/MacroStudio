import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { MacroDef, MacroReport, StatusEvent } from './types';

export const isTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function applyMacros(macros: MacroDef[]): Promise<MacroReport[]> {
  if (!isTauri()) return [];
  return invoke<MacroReport[]>('apply_macros', { macros });
}

export async function startMacro(id: string) {
  if (isTauri()) await invoke('start_macro', { id });
}

export async function stopMacro(id: string) {
  if (isTauri()) await invoke('stop_macro', { id });
}

export async function stopAll() {
  if (isTauri()) await invoke('stop_all');
}

export async function onStatus(cb: (e: StatusEvent) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  return listen<StatusEvent>('macro-status', (e) => cb(e.payload));
}

/** Сохраняет текст в файл (диалог «Сохранить как»). Возвращает true, если файл записан. */
export async function exportText(fileName: string, text: string): Promise<boolean> {
  if (isTauri()) {
    const path = await save({
      defaultPath: fileName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return false;
    await invoke('write_text_file', { path, content: text });
    return true;
  }
  // режим разработки в обычном браузере
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/** Открывает диалог выбора JSON и возвращает его текст (или null, если отменили). */
export async function importText(): Promise<string | null> {
  if (isTauri()) {
    const path = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path || Array.isArray(path)) return null;
    return invoke<string>('read_text_file', { path });
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? await f.text() : null);
    };
    input.click();
  });
}
