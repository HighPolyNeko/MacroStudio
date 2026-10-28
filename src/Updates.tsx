import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import type { ReleaseInfo, Update } from './api';

/*
 * Обновление приложения: карточка в правом нижнем углу.
 * Она не модальная — под ней всё работает, макросы запускаются (и с горячих клавиш, и кнопками).
 *
 * Шаги: доступно → скачивание (полоса 0–100%) → скачано, полоса полная, ждём «Перезапустить»
 * → установка (приложение закрывается, установщик запускает новую версию).
 */

/** Сколько держать на кнопке «✓ У вас последняя версия». */
const UP_TO_DATE_MS = 4000;
/** Сколько пунктов изменений показывать в свёрнутом виде. */
const SHORT_ITEMS = 3;

export type Phase = 'available' | 'downloading' | 'ready' | 'installing' | 'error';

interface UpdateState {
  update: Update;
  notes: string;
  phase: Phase;
  /** 0..1; null — размер неизвестен, полоса «бегущая». */
  progress: number | null;
  error?: string;
}

export type Panel = 'update' | 'whatsnew' | null;

export function useUpdater(notify: (text: string) => void) {
  const [version, setVersion] = useState<string | null>(null);
  const [upd, setUpd] = useState<UpdateState | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [checking, setChecking] = useState(false);
  // «у вас последняя версия» показывается на самой кнопке несколько секунд, а не всплывашкой
  const [upToDate, setUpToDate] = useState(false);
  useEffect(() => {
    if (!upToDate) return;
    const t = setTimeout(() => setUpToDate(false), UP_TO_DATE_MS);
    return () => clearTimeout(t);
  }, [upToDate]);
  const updRef = useRef(upd);
  updRef.current = upd;

  const check = useCallback(
    async (manual: boolean) => {
      // уже нашли (качается, скачано) — просто показать карточку
      const cur = updRef.current;
      if (cur && cur.phase !== 'error') {
        setPanel('update');
        return;
      }
      setChecking(true);
      setUpToDate(false);
      try {
        const update = await api.findUpdate(manual);
        if (update) {
          const notes = (await api.fetchReleaseNotes(update.version)) ?? update.body ?? '';
          setUpd({ update, notes, phase: 'available', progress: 0 });
          setPanel('update');
        } else if (manual) {
          setUpToDate(true);
        }
      } catch (e) {
        if (manual) notify(`Не удалось проверить обновления: ${String(e)}`);
      } finally {
        setChecking(false);
      }
    },
    [notify],
  );

  // при запуске: версия и тихая проверка
  useEffect(() => {
    api.appVersion().then(setVersion);
    check(false);
  }, [check]);

  const download = async () => {
    const cur = updRef.current;
    if (!cur) return;
    setUpd({ ...cur, phase: 'downloading', progress: 0, error: undefined });
    try {
      await api.downloadUpdate(cur.update, (done, total) =>
        setUpd((s) => s && { ...s, progress: total ? Math.min(1, done / total) : null }),
      );
      setUpd((s) => s && { ...s, phase: 'ready', progress: 1 });
      setPanel('update');
    } catch (e) {
      setUpd((s) => s && { ...s, phase: 'error', error: `Не удалось скачать: ${String(e)}` });
      setPanel('update');
    }
  };

  const install = async () => {
    const cur = updRef.current;
    if (!cur) return;
    setUpd({ ...cur, phase: 'installing', progress: 1 });
    try {
      await api.installUpdate(cur.update);
    } catch (e) {
      setUpd((s) => s && { ...s, phase: 'error', error: `Не удалось установить: ${String(e)}` });
    }
  };

  return {
    version,
    upd,
    panel,
    checking,
    upToDate,
    checkNow: () => check(true),
    openWhatsNew: () => setPanel('whatsnew'),
    close: () => setPanel(null),
    download,
    install,
  };
}

export type Updater = ReturnType<typeof useUpdater>;

/** Подпись кнопки «Проверить обновления»: пока обновление качается или ждёт перезапуска — его статус. */
export function updateButtonLabel(u: Updater): string {
  if (u.checking) return 'Проверяю…';
  if (u.upToDate) return '✓ У вас последняя версия';
  switch (u.upd?.phase) {
    case 'downloading':
      return u.upd.progress === null
        ? 'Скачивание обновления…'
        : `Скачивание ${Math.round(u.upd.progress * 100)}%`;
    case 'ready':
    case 'installing':
      return '⟳ Установить обновление';
    default:
      return '⟳ Проверить обновления';
  }
}

/* ---------- Карточка ---------- */

export function UpdateCard({ u }: { u: Updater }) {
  if (!u.panel) return null;
  const isUpdate = u.panel === 'update' && u.upd;
  return (
    <div className="update-card" role="dialog" aria-label="Обновление Macro Studio">
      {/* шапка закреплена: при прокрутке длинного списка заголовок и крестик остаются на месте */}
      <div className="card-head">
        <h3>{isUpdate ? `Доступна версия ${u.upd!.update.version}` : 'Что нового'}</h3>
        <button className="card-close" title="Закрыть" onClick={u.close}>
          ×
        </button>
      </div>
      {isUpdate ? <UpdateBody u={u} s={u.upd!} /> : <WhatsNew current={u.version} />}
    </div>
  );
}

function UpdateBody({ u, s }: { u: Updater; s: UpdateState }) {
  return (
    <>
      <p className="muted">У вас {s.update.currentVersion}</p>
      <Notes md={s.notes} short />

      {s.phase !== 'available' && s.phase !== 'error' && (
        <div className="update-progress">
          <div className={`progress ${s.progress === null ? 'indeterminate' : ''}`}>
            <div style={{ width: s.progress === null ? undefined : `${Math.round(s.progress * 100)}%` }} />
          </div>
          <small className="muted">
            {s.phase === 'downloading' && 'Скачивание…'}
            {s.phase === 'ready' && 'Скачано. Осталось установить — приложение перезапустится.'}
            {s.phase === 'installing' && 'Установка… приложение сейчас закроется и запустится снова.'}
          </small>
        </div>
      )}
      {s.phase === 'error' && <div className="error-box">⚠ {s.error}</div>}

      <div className="row card-actions">
        {s.phase === 'available' && (
          <>
            <button className="primary" onClick={u.download}>
              Обновить
            </button>
            <button onClick={u.close}>Позже</button>
          </>
        )}
        {s.phase === 'downloading' && <button onClick={u.close}>Скрыть</button>}
        {s.phase === 'ready' && (
          <>
            <button className="primary" onClick={u.install}>
              Перезапустить
            </button>
            <button onClick={u.close}>Позже</button>
          </>
        )}
        {s.phase === 'error' && (
          <>
            <button className="primary" onClick={u.download}>
              Повторить
            </button>
            <button onClick={u.close}>Закрыть</button>
          </>
        )}
      </div>
      {s.phase === 'ready' && <small className="muted">Запущенные макросы остановятся.</small>}
    </>
  );
}

function WhatsNew({ current }: { current: string | null }) {
  const [releases, setReleases] = useState<ReleaseInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .fetchReleases()
      .then(setReleases)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <>
      {error && <div className="error-box">⚠ Не удалось загрузить список изменений: {error}</div>}
      {!releases && !error && <p className="muted">Загрузка…</p>}
      {releases?.length === 0 && <p className="muted">Релизов пока нет.</p>}
      {releases?.map((r) => (
        <section key={r.version} className="release">
          <div className="release-head">
            <strong>{r.version}</strong>
            {r.version === current && <span className="badge">установлена</span>}
            {r.date && <span className="muted">{new Date(r.date).toLocaleDateString('ru-RU')}</span>}
          </div>
          <Notes md={r.notes} />
        </section>
      ))}
    </>
  );
}

/* ---------- Список изменений (markdown: заголовки ###, пункты «- », абзацы) ---------- */

type Block = { kind: 'h' | 'li' | 'p'; text: string };

function parseNotes(md: string): Block[] {
  return md
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l): Block => {
      if (/^#{1,6}\s/.test(l)) return { kind: 'h', text: l.replace(/^#+\s*/, '') };
      if (/^[-*]\s/.test(l)) return { kind: 'li', text: l.replace(/^[-*]\s+/, '') };
      return { kind: 'p', text: l };
    });
}

function Notes({ md, short = false }: { md: string; short?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const blocks = parseNotes(md);
  const items = blocks.filter((b) => b.kind === 'li');
  if (!blocks.length) return <p className="muted">Описание изменений не указано.</p>;

  // свёрнуто: первые пункты без заголовков
  const collapsed = short && !expanded && items.length > SHORT_ITEMS;
  const shown = collapsed ? items.slice(0, SHORT_ITEMS) : blocks;

  return (
    <div className="notes">
      {renderBlocks(shown)}
      {short && items.length > SHORT_ITEMS && (
        <button className="link" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Свернуть' : `Показать все изменения (${items.length})`}
        </button>
      )}
    </div>
  );
}

function renderBlocks(blocks: Block[]) {
  const out: JSX.Element[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={`ul${out.length}`}>
          {list.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  blocks.forEach((b, i) => {
    if (b.kind === 'li') {
      list.push(b.text);
      return;
    }
    flush();
    out.push(b.kind === 'h' ? <h4 key={i}>{b.text}</h4> : <p key={i}>{b.text}</p>);
  });
  flush();
  return out;
}
