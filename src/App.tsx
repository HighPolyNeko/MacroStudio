import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api';
import { Editor } from './Editor';
import { KeyCapture } from './KeyCapture';
import { newId, newMacro, normalizeMacro, sampleMacro, semanticKey, toExport } from './macros';
import { MODE_LABELS, type MacroDef, type TriggerMode } from './types';

const STORAGE = 'macro-studio:v1';

function loadLibrary(): MacroDef[] {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr.map(normalizeMacro);
    }
  } catch {
    /* повреждённое хранилище — начнём с примера */
  }
  return [sampleMacro()];
}

const fileName = (name: string) => `${name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'macro'}.json`;

export default function App() {
  const [macros, setMacros] = useState<MacroDef[]>(loadLibrary);
  const [selectedId, setSelectedId] = useState<string>(() => macros[0].id);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const selected = macros.find((m) => m.id === selectedId) ?? macros[0];

  const update = useCallback((id: string, patch: Partial<MacroDef>) => {
    setMacros((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  // сохранение в localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(macros));
    } catch {
      /* ignore */
    }
  }, [macros]);

  // отправка в движок — только когда изменился смысл макросов (не позиции узлов)
  const key = useMemo(() => semanticKey(macros), [macros]);
  const macrosRef = useRef(macros);
  macrosRef.current = macros;
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const reports = await api.applyMacros(macrosRef.current);
        setRunning({});
        setErrors(Object.fromEntries(reports.map((r) => [r.id, r.error])));
      } catch (e) {
        setNotice(`Ошибка движка: ${String(e)}`);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [key]);

  // статусы запуска из движка
  useEffect(() => {
    let off: (() => void) | undefined;
    let dead = false;
    api
      .onStatus((e) => {
        setRunning((r) => ({ ...r, [e.id]: e.running }));
        if (e.error) setErrors((er) => ({ ...er, [e.id]: e.error }));
      })
      .then((u) => (dead ? u() : (off = u)));
    return () => {
      dead = true;
      off?.();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const addMacro = () => {
    const m = newMacro(`Макрос ${macros.length + 1}`);
    setMacros((ms) => [...ms, m]);
    setSelectedId(m.id);
  };

  const duplicate = () => {
    const copy: MacroDef = {
      ...structuredClone(selected),
      id: newId('m'),
      name: `${selected.name} (копия)`,
      trigger: { ...selected.trigger, key: '' },
    };
    setMacros((ms) => [...ms, copy]);
    setSelectedId(copy.id);
  };

  const remove = () => {
    if (macros.length === 1) {
      const m = newMacro();
      setMacros([m]);
      setSelectedId(m.id);
      return;
    }
    const rest = macros.filter((m) => m.id !== selected.id);
    setMacros(rest);
    setSelectedId(rest[0].id);
  };

  const doExport = async () => {
    try {
      const ok = await api.exportText(fileName(selected.name), JSON.stringify(toExport(selected), null, 2));
      if (ok) setNotice('Макрос сохранён в файл.');
    } catch (e) {
      setNotice(`Не удалось сохранить: ${String(e)}`);
    }
  };

  const doImport = async () => {
    try {
      const text = await api.importText();
      if (text === null) return;
      const parsed = JSON.parse(text);
      const list = (Array.isArray(parsed) ? parsed : [parsed]).map((raw) => {
        const m = normalizeMacro(raw);
        return { ...m, id: newId('m') };
      });
      if (!list.length) throw new Error('в файле нет макросов');
      setMacros((ms) => [...ms, ...list]);
      setSelectedId(list[0].id);
      setNotice(`Импортировано макросов: ${list.length}`);
    } catch (e) {
      setNotice(`Не удалось импортировать: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const err = errors[selected.id];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Macro Studio</div>
        <div className="side-actions">
          <button onClick={addMacro}>+ Новый</button>
          <button onClick={doImport}>Импорт</button>
        </div>
        <ul className="macro-list">
          {macros.map((m) => (
            <li
              key={m.id}
              className={m.id === selected.id ? 'active' : ''}
              onClick={() => setSelectedId(m.id)}
            >
              <span className={`dot ${running[m.id] ? 'on' : ''}`} />
              <div className="macro-meta">
                <div className="macro-name">{m.name || 'Без названия'}</div>
                <div className="macro-sub">
                  {m.trigger.key ? `${m.trigger.key} · ${shortMode(m.trigger.mode)}` : 'без горячей клавиши'}
                  {!m.enabled && ' · выключен'}
                </div>
                {errors[m.id] && <div className="macro-err">⚠ {errors[m.id]}</div>}
              </div>
              <button
                className="play"
                title={running[m.id] ? 'Остановить' : 'Запустить'}
                onClick={(e) => {
                  e.stopPropagation();
                  running[m.id] ? api.stopMacro(m.id) : api.startMacro(m.id);
                }}
              >
                {running[m.id] ? '■' : '▶'}
              </button>
            </li>
          ))}
        </ul>
        <div className="side-foot">
          <button className="danger" onClick={() => api.stopAll()}>
            Остановить всё
          </button>
          <small>Аварийная остановка с клавиатуры — клавиша Pause (Break).</small>
        </div>
      </aside>

      <main className="main">
        {notice && <div className="notice">{notice}</div>}
        <Editor key={selected.id} macro={selected} onUpdate={(p) => update(selected.id, p)}>
          <div className="panel">
            <h3>Макрос</h3>
            <label className="field">
              <span>Название</span>
              <input value={selected.name} onChange={(e) => update(selected.id, { name: e.target.value })} />
            </label>
            <label className="field">
              <span>Горячая клавиша</span>
              <KeyCapture
                allowMouse
                allowClear
                value={selected.trigger.key}
                onChange={(k) => update(selected.id, { trigger: { ...selected.trigger, key: k } })}
              />
              <small>Не используйте её внутри самого макроса. Мышь: средняя, X1, X2.</small>
            </label>
            <label className="field">
              <span>Режим запуска</span>
              <select
                value={selected.trigger.mode}
                onChange={(e) =>
                  update(selected.id, { trigger: { ...selected.trigger, mode: e.target.value as TriggerMode } })
                }
              >
                {(Object.keys(MODE_LABELS) as TriggerMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
              <small>В режимах «вкл/выкл» и «пока зажата» макрос повторяется по кругу.</small>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={selected.enabled}
                onChange={(e) => update(selected.id, { enabled: e.target.checked })}
              />
              Горячая клавиша включена
            </label>
            {err && <div className="error-box">⚠ {err}</div>}
            <div className="row">
              <button onClick={doExport}>Экспорт JSON</button>
              <button onClick={duplicate}>Дублировать</button>
              <button className="danger" onClick={remove}>
                Удалить
              </button>
            </div>
            <p className="muted">Выберите узел на схеме, чтобы настроить его. Удалить узел — клавиша Delete.</p>
          </div>
        </Editor>
      </main>
    </div>
  );
}

function shortMode(m: TriggerMode): string {
  return m === 'toggle' ? 'вкл/выкл' : m === 'hold' ? 'пока зажата' : 'один раз';
}
