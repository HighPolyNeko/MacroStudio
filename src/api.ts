import { invoke } from '@tauri-apps/api/core';
import { listen, once } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
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

/**
 * Проверяет релизы на GitHub. Если есть версия новее — спрашивает и ставит её с перезапуском.
 * Ошибка проверки (нет сети, ещё нет ни одного релиза) не мешает работе: просто нет обновления.
 * В режиме разработки (tauri dev) не проверяет.
 */
export async function checkForUpdates(): Promise<void> {
  if (!isTauri() || import.meta.env.DEV) return;
  let update;
  try {
    update = await check();
  } catch (e) {
    console.warn('Проверка обновлений не удалась:', e);
    return;
  }
  if (!update) return;
  const yes = await ask(
    `Доступна версия ${update.version} (у вас ${update.currentVersion}).\n\n` +
      'Установить сейчас? Запущенные макросы остановятся, приложение перезапустится.',
    { title: 'Обновление Macro Studio', kind: 'info', okLabel: 'Обновить', cancelLabel: 'Позже' },
  );
  if (!yes) return;
  await update.downloadAndInstall();
  await relaunch();
}

/** Это окно выбора точки (а не главное окно)? */
export const isPickerWindow = () => isTauri() && getCurrentWindow().label === 'picker';

/**
 * Показывает полупрозрачное окно на весь экран и ждёт клика.
 * Возвращает координаты точки в пикселях экрана или null, если выбор отменили.
 */
export async function pickPoint(): Promise<{ x: number; y: number } | null> {
  if (!isTauri()) return null;
  const result = new Promise<{ x: number; y: number } | null>((resolve) => {
    once<{ x: number; y: number } | null>('point-picked', (e) => resolve(e.payload));
  });
  await invoke('start_pick_point');
  return result;
}

/** Вызывается окном выбора: клик (cancel = false) или отмена. */
export async function finishPickPoint(cancel: boolean) {
  if (isTauri()) await invoke('finish_pick_point', { cancel });
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
