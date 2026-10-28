import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen, once } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
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

/** Версия приложения из tauri.conf.json (вне Tauri — null). */
export async function appVersion(): Promise<string | null> {
  return isTauri() ? getVersion() : null;
}

export type { Update };

/**
 * Есть ли на GitHub версия новее (по latest.json последнего релиза).
 * При запуске (manual = false) ошибка проверки (нет сети и т.п.) не мешает работе: просто нет обновления,
 * а в режиме разработки (tauri dev) проверки нет. По кнопке (manual = true) ошибка пробрасывается.
 */
export async function findUpdate(manual: boolean): Promise<Update | null> {
  if (!isTauri() || (import.meta.env.DEV && !manual)) return null;
  try {
    return await check();
  } catch (e) {
    if (manual) throw e;
    console.warn('Проверка обновлений не удалась:', e);
    return null;
  }
}

/** Скачивает обновление; onProgress(скачано байт, всего байт или null, если сервер не сказал). */
export async function downloadUpdate(
  update: Update,
  onProgress: (done: number, total: number | null) => void,
): Promise<void> {
  let total: number | null = null;
  let done = 0;
  await update.download((e) => {
    if (e.event === 'Started') total = e.data.contentLength ?? null;
    else if (e.event === 'Progress') {
      done += e.data.chunkLength;
      onProgress(done, total);
    }
  });
}

/** Ставит скачанное обновление. В Windows приложение закрывается, установщик запускает новую версию сам. */
export async function installUpdate(update: Update): Promise<void> {
  await update.install();
  await relaunch();
}

const RELEASES_API = 'https://api.github.com/repos/HighPolyNeko/MacroStudio/releases';

export interface ReleaseInfo {
  version: string;
  /** ISO-дата публикации. */
  date: string | null;
  /** Описание релиза (markdown). */
  notes: string;
}

/**
 * Последние релизы с GitHub. Описание берётся из релиза, а не из latest.json:
 * его можно поправить на сайте (опечатки), и исправление сразу видно в приложении.
 */
export async function fetchReleases(limit = 10): Promise<ReleaseInfo[]> {
  const r = await fetch(`${RELEASES_API}?per_page=${limit}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error(`GitHub ответил ${r.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list: any[] = await r.json();
  return list
    .filter((x) => !x.draft)
    .map((x) => ({ version: x.tag_name, date: x.published_at ?? null, notes: x.body ?? '' }));
}

/** Описание конкретного релиза с GitHub или null (нет сети, нет релиза). */
export async function fetchReleaseNotes(version: string): Promise<string | null> {
  try {
    const r = await fetch(`${RELEASES_API}/tags/${encodeURIComponent(version)}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return null;
    return ((await r.json()).body as string | undefined) ?? null;
  } catch {
    return null;
  }
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
