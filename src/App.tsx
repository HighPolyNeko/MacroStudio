import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api';
import { Dropdown } from './Dropdown';
import { Editor } from './Editor';
import { KeyCapture } from './KeyCapture';
import { MacroList } from './MacroList';
import { UpdateCard, updateButtonLabel, useUpdater } from './Updates';
import { newId, newMacro, normalizeMacro, sampleMacro, semanticKey, toExport } from './macros';
import { MODE_LABELS, type Folder, type MacroDef, type TriggerMode } from './types';

const STORAGE = 'macro-studio:v1';
const FOLDERS_STORAGE = 'macro-studio:folders:v1';

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

function loadFolders(): Folder[] {
  try {
    const arr = JSON.parse(localStorage.getItem(FOLDERS_STORAGE) ?? '[]');
    if (Array.isArray(arr))
      return arr
        .filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
        .map((f) => ({ id: f.id, name: f.name, collapsed: !!f.collapsed }));
  } catch {
    /* повреждённое хранилище — без папок */
  }
  return [];
}

const fileName = (name: string) => `${name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'macro'}.json`;

export default function App() {
  const [macros, setMacros] = useState<MacroDef[]>(loadLibrary);
  const [folders, setFolders] = useState<Folder[]>(loadFolders);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
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
  useEffect(() => {
    try {
      localStorage.setItem(FOLDERS_STORAGE, JSON.stringify(folders));
    } catch {
      /* ignore */
    }
  }, [folders]);

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

  // обновление с GitHub: проверка при запуске, карточка обновления, «что нового»
  const updater = useUpdater(setNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const addMacro = (folderId?: string) => {
    const m: MacroDef = { ...newMacro(`Макрос ${macros.length + 1}`), ...(folderId ? { folderId } : {}) };
    setMacros((ms) => [...ms, m]);
    setSelectedId(m.id);
    if (folderId) setFolders((fs) => fs.map((f) => (f.id === folderId ? { ...f, collapsed: false } : f)));
  };

  /* ---------- папки ---------- */

  const addFolder = () => {
    const f: Folder = { id: newId('f'), name: `Папка ${folders.length + 1}`, collapsed: false };
    setFolders((fs) => [...fs, f]);
    setRenamingFolder(f.id); // сразу ввести имя
  };
  const patchFolder = (id: string, patch: Partial<Folder>) =>
    setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  /** Удаляет папку; её макросы остаются — без папки. */
  const deleteFolder = (id: string) => {
    setFolders((fs) => fs.filter((f) => f.id !== id));
    setMacros((ms) => ms.map((m) => (m.folderId === id ? withoutFolder(m) : m)));
  };
  /** Ставит папку перед/после папки anchorId. */
  const moveFolder = (id: string, anchorId: string, after: boolean) =>
    setFolders((fs) => {
      const f = fs.find((x) => x.id === id);
      if (!f) return fs;
      const rest = fs.filter((x) => x.id !== id);
      const i = rest.findIndex((x) => x.id === anchorId);
      const at = i < 0 ? rest.length : after ? i + 1 : i;
      return [...rest.slice(0, at), f, ...rest.slice(at)];
    });
  /** Включает или выключает горячие клавиши всех макросов папки. */
  const setFolderEnabled = (id: string, enabled: boolean) =>
    setMacros((ms) => ms.map((m) => (m.folderId === id ? { ...m, enabled } : m)));

  /* ---------- действия с макросом (кнопки справа и меню по ПКМ в списке) ---------- */

  /** Копия ставится сразу после оригинала, в ту же папку; горячая клавиша у копии пустая. */
  const duplicateMacro = (src: MacroDef) => {
    const copy: MacroDef = {
      ...structuredClone(src),
      id: newId('m'),
      name: `${src.name} (копия)`,
      trigger: { ...src.trigger, key: '' },
    };
    setMacros((ms) => {
      const i = ms.findIndex((m) => m.id === src.id);
      return [...ms.slice(0, i + 1), copy, ...ms.slice(i + 1)];
    });
    setSelectedId(copy.id);
  };

  const removeMacro = (id: string) => {
    if (macros.length === 1) {
      const m = newMacro();
      setMacros([m]);
      setSelectedId(m.id);
      return;
    }
    const rest = macros.filter((m) => m.id !== id);
    setMacros(rest);
    if (id === selected.id) setSelectedId(rest[0].id);
  };

  const exportMacro = async (m: MacroDef) => {
    try {
      const ok = await api.exportText(fileName(m.name), JSON.stringify(toExport(m), null, 2));
      if (ok) setNotice('Макрос сохранён в файл.');
    } catch (e) {
      setNotice(`Не удалось сохранить: ${String(e)}`);
    }
  };

  /**
   * Переносит макрос: в папку (или без папки, folderId = undefined) и на место —
   * перед/после макроса anchorId; без anchorId — в конец.
   */
  const moveMacro = (id: string, to: { folderId?: string; anchorId?: string; after?: boolean }) =>
    setMacros((ms) => {
      const m = ms.find((x) => x.id === id);
      if (!m) return ms;
      const rest = ms.filter((x) => x.id !== id);
      const moved = to.folderId ? { ...withoutFolder(m), folderId: to.folderId } : withoutFolder(m);
      let at = rest.length;
      if (to.anchorId) {
        const i = rest.findIndex((x) => x.id === to.anchorId);
        if (i >= 0) at = to.after ? i + 1 : i;
      }
      return [...rest.slice(0, at), moved, ...rest.slice(at)];
    });

  const doImport = async () => {
    try {
      const text = await api.importText();
      if (text === null) return;
      const parsed = JSON.parse(text);
      const list = (Array.isArray(parsed) ? parsed : [parsed]).map((raw) => {
        const { folderId: _f, ...m } = normalizeMacro(raw);
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
          <button onClick={() => addMacro()}>+ Новый</button>
          <button onClick={addFolder} title="Папка для макросов, например по игре">+ Папка</button>
          <button onClick={doImport}>Импорт</button>
        </div>
        <MacroList
          macros={macros}
          folders={folders}
          selectedId={selected.id}
          running={running}
          errors={errors}
          renamingId={renamingFolder}
          onSelect={setSelectedId}
          onAddMacro={addMacro}
          onRenameStart={setRenamingFolder}
          onRenameFolder={(id, name) => patchFolder(id, { name })}
          onToggleCollapsed={(id) => patchFolder(id, { collapsed: !folders.find((f) => f.id === id)?.collapsed })}
          onSetFolderEnabled={setFolderEnabled}
          onDeleteFolder={deleteFolder}
          onMoveMacro={moveMacro}
          onExportMacro={exportMacro}
          onDuplicateMacro={duplicateMacro}
          onRemoveMacro={removeMacro}
          onMoveFolder={moveFolder}
        />
        <div className="side-foot">
          <button className="danger" onClick={() => api.stopAll()}>
            Остановить всё
          </button>
          <small>Аварийная остановка с клавиатуры — клавиша Pause (Break).</small>
          <div className="update-box">
            <button
              disabled={!api.isTauri() || updater.checking}
              title={api.isTauri() ? undefined : 'Работает только в приложении'}
              onClick={updater.checkNow}
            >
              {updateButtonLabel(updater)}
            </button>
            <div className="version-line">
              <small>{updater.version ? `Macro Studio ${updater.version}` : 'Macro Studio'}</small>
              <button className="icon-btn" title="Что нового" onClick={updater.openWhatsNew}>
                i
              </button>
            </div>
          </div>
        </div>
      </aside>

      <UpdateCard u={updater} />

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
              <span>Папка</span>
              <Dropdown
                value={folders.some((f) => f.id === selected.folderId) ? selected.folderId! : ''}
                options={[['', 'Без папки'], ...folders.map((f): [string, string] => [f.id, f.name])]}
                onChange={(v) =>
                  v
                    ? update(selected.id, { folderId: v })
                    : setMacros((ms) => ms.map((m) => (m.id === selected.id ? withoutFolder(m) : m)))
                }
              />
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
              <Dropdown
                value={selected.trigger.mode}
                options={(Object.keys(MODE_LABELS) as TriggerMode[]).map((m): [TriggerMode, string] => [m, MODE_LABELS[m]])}
                onChange={(mode) => update(selected.id, { trigger: { ...selected.trigger, mode } })}
              />
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
              <button onClick={() => exportMacro(selected)}>Экспорт JSON</button>
              <button onClick={() => duplicateMacro(selected)}>Дублировать</button>
              <button className="danger" onClick={() => removeMacro(selected.id)}>
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

function withoutFolder(m: MacroDef): MacroDef {
  const { folderId: _f, ...rest } = m;
  return rest;
}
