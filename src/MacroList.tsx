import { useState, type DragEvent } from 'react';
import * as api from './api';
import { ContextMenu, MenuItem, MenuSeparator, SubMenu } from './ContextMenu';
import type { Folder, MacroDef, TriggerMode } from './types';

interface Props {
  macros: MacroDef[];
  folders: Folder[];
  selectedId: string;
  running: Record<string, boolean>;
  errors: Record<string, string | null>;
  /** Папка, которую сейчас переименовывают (только что созданная — сразу в режиме ввода). */
  renamingId: string | null;
  onSelect: (id: string) => void;
  onAddMacro: (folderId?: string) => void;
  onRenameStart: (id: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onToggleCollapsed: (id: string) => void;
  onSetFolderEnabled: (id: string, enabled: boolean) => void;
  onDeleteFolder: (id: string) => void;
  /** В папку (folderId; без него — без папки) и на место: перед/после anchorId, без него — в конец. */
  onMoveMacro: (id: string, to: { folderId?: string; anchorId?: string; after?: boolean }) => void;
  onExportMacro: (m: MacroDef) => void;
  onDuplicateMacro: (m: MacroDef) => void;
  onRemoveMacro: (id: string) => void;
  /** Переставить папку перед/после папки anchorId. */
  onMoveFolder: (id: string, anchorId: string, after: boolean) => void;
}

/** Куда сейчас бросят перетаскиваемый макрос или папку (для подсветки). */
type DropTarget =
  | { kind: 'macro'; id: string; after: boolean }
  | { kind: 'folder'; id: string }
  | { kind: 'root' }
  /** папку — перед/после другой папки */
  | { kind: 'folder-pos'; id: string; after: boolean };

/** Состояние, общее для всех строк списка: перетаскивание и меню по ПКМ. */
interface ListState {
  /** Перетаскиваемый макрос. */
  dragId: string | null;
  /** Перетаскиваемая папка. */
  dragFolder: string | null;
  drop: DropTarget | null;
  setDragId: (id: string | null) => void;
  setDragFolder: (id: string | null) => void;
  setDrop: (t: DropTarget | null) => void;
  openMenu: (m: MacroDef, x: number, y: number) => void;
}

/** Список макросов слева: папки (например, по играм), в конце — макросы без папки. */
export function MacroList(p: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragFolder, setDragFolder] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [menu, setMenu] = useState<{ m: MacroDef; x: number; y: number } | null>(null);
  const ls: ListState = {
    dragId,
    dragFolder,
    drop,
    setDragId,
    setDragFolder,
    setDrop,
    openMenu: (m, x, y) => setMenu({ m, x, y }),
  };

  const known = new Set(p.folders.map((f) => f.id));
  const loose = p.macros.filter((m) => !m.folderId || !known.has(m.folderId));
  const folderOf = (m: MacroDef) => (m.folderId && known.has(m.folderId) ? m.folderId : undefined);

  /** Бросили: на макрос — встать перед/после него в его папке; на папку — в конец папки; в «Без папки» — в конец. */
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const id = dragId;
    const folderId = dragFolder;
    setDragId(null);
    setDragFolder(null);
    setDrop(null);
    if (folderId && drop?.kind === 'folder-pos' && drop.id !== folderId) {
      p.onMoveFolder(folderId, drop.id, drop.after);
      return;
    }
    if (!id || !drop) return;
    if (drop.kind === 'macro') {
      const target = p.macros.find((m) => m.id === drop.id);
      if (target && target.id !== id) p.onMoveMacro(id, { folderId: folderOf(target), anchorId: target.id, after: drop.after });
    } else if (drop.kind === 'folder') {
      p.onMoveMacro(id, { folderId: drop.id });
    } else if (drop.kind === 'root') {
      p.onMoveMacro(id, {});
    }
  };

  return (
    <>
      <ul className="macro-list" onDrop={onDrop} onDragOver={(e) => (dragId || dragFolder) && e.preventDefault()}>
        {p.folders.map((f) => {
          const inside = p.macros.filter((m) => m.folderId === f.id);
          return (
            <li key={f.id} className={`folder ${dragFolder === f.id ? 'dragging' : ''}`}>
              <FolderHead {...p} ls={ls} folder={f} macros={inside} />
              {!f.collapsed && (
                <ul className="folder-items">
                  {inside.map((m) => (
                    <MacroItem key={m.id} {...p} ls={ls} m={m} />
                  ))}
                  {!inside.length && (
                    <li
                      className="folder-empty"
                      onDragOver={(e) => {
                        if (!dragId) return;
                        e.preventDefault();
                        setDrop({ kind: 'folder', id: f.id });
                      }}
                    >
                      Пусто — «+» или перетащите макрос сюда
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
        {loose.map((m) => (
          <MacroItem key={m.id} {...p} ls={ls} m={m} />
        ))}
        {/* куда бросить, чтобы убрать из папки (видно только во время перетаскивания) */}
        {dragId && (
          <li
            className={`drop-root ${drop?.kind === 'root' ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrop({ kind: 'root' });
            }}
          >
            Без папки
          </li>
        )}
      </ul>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MacroMenu {...p} m={menu.m} folderId={folderOf(menu.m)} close={() => setMenu(null)} />
        </ContextMenu>
      )}
    </>
  );
}

/** Меню по ПКМ на макросе. «Удалить» — всегда последним и красным. */
function MacroMenu({ m, folderId, close, ...p }: Props & { m: MacroDef; folderId?: string; close: () => void }) {
  const act = (fn: () => void) => () => {
    close();
    fn();
  };
  const others = p.folders.filter((f) => f.id !== folderId);
  return (
    <>
      <MenuItem onClick={act(() => p.onExportMacro(m))}>Экспорт JSON</MenuItem>
      <MenuItem onClick={act(() => p.onDuplicateMacro(m))}>Дублировать</MenuItem>
      {others.length > 0 && (
        <SubMenu label="В папку">
          {others.map((f) => (
            <MenuItem key={f.id} onClick={act(() => p.onMoveMacro(m.id, { folderId: f.id }))}>
              {f.name}
            </MenuItem>
          ))}
        </SubMenu>
      )}
      {folderId && <MenuItem onClick={act(() => p.onMoveMacro(m.id, {}))}>Убрать из папки</MenuItem>}
      <MenuSeparator />
      <MenuItem danger onClick={act(() => p.onRemoveMacro(m.id))}>
        Удалить
      </MenuItem>
    </>
  );
}

function FolderHead({ folder: f, macros, ls, ...p }: Props & { folder: Folder; macros: MacroDef[]; ls: ListState }) {
  const enabledCount = macros.filter((m) => m.enabled).length;
  const all = macros.length > 0 && enabledCount === macros.length;
  const some = enabledCount > 0 && !all;
  const d = ls.drop;
  const over =
    d?.kind === 'folder' && d.id === f.id
      ? 'drop-over'
      : d?.kind === 'folder-pos' && d.id === f.id
        ? d.after
          ? 'drop-after'
          : 'drop-before'
        : '';

  return (
    <div
      className={`folder-head ${over}`}
      // папку тянут за шапку (кроме режима переименования — там выделяют текст)
      draggable={p.renamingId !== f.id}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', f.id);
        ls.setDragFolder(f.id);
      }}
      onDragEnd={() => {
        ls.setDragFolder(null);
        ls.setDrop(null);
      }}
      onDragOver={(e) => {
        if (ls.dragFolder) {
          // папку над другой папкой: верхняя половина шапки — встать перед ней, нижняя — после
          if (ls.dragFolder === f.id) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          ls.setDrop({ kind: 'folder-pos', id: f.id, after: e.clientY > r.top + r.height / 2 });
          return;
        }
        if (!ls.dragId) return;
        e.preventDefault();
        ls.setDrop({ kind: 'folder', id: f.id });
      }}
    >
      <button className="ghost folder-arrow" title={f.collapsed ? 'Развернуть' : 'Свернуть'} onClick={() => p.onToggleCollapsed(f.id)}>
        {f.collapsed ? '▸' : '▾'}
      </button>
      {p.renamingId === f.id ? (
        <FolderNameInput
          initial={f.name}
          onDone={(name) => {
            if (name !== null) p.onRenameFolder(f.id, name);
            p.onRenameStart(null);
          }}
        />
      ) : (
        <span className="folder-name" title="Двойной клик — переименовать" onDoubleClick={() => p.onRenameStart(f.id)}>
          {f.name}
          <span className="folder-count">{macros.length}</span>
        </span>
      )}
      <button
        className={`switch ${all ? 'on' : ''} ${some ? 'some' : ''}`}
        disabled={!macros.length}
        title={all ? 'Выключить все макросы в папке' : 'Включить все макросы в папке'}
        onClick={() => p.onSetFolderEnabled(f.id, !all)}
      >
        <span />
      </button>
      <button className="ghost folder-btn" title="Новый макрос в этой папке" onClick={() => p.onAddMacro(f.id)}>
        +
      </button>
      <button
        className="ghost folder-btn"
        title="Удалить папку (макросы останутся, без папки)"
        onClick={() => p.onDeleteFolder(f.id)}
      >
        ×
      </button>
    </div>
  );
}

/** Ввод имени папки: Enter или уход фокуса — сохранить, Esc — отмена (null). */
function FolderNameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const finish = () => onDone(value.trim() || initial);
  return (
    <input
      className="folder-input"
      autoFocus
      value={value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish();
        if (e.key === 'Escape') onDone(null);
      }}
    />
  );
}

function MacroItem({ m, ls, ...p }: Props & { m: MacroDef; ls: ListState }) {
  const running = p.running[m.id];
  const over = ls.drop?.kind === 'macro' && ls.drop.id === m.id ? (ls.drop.after ? 'drop-after' : 'drop-before') : '';
  const classes = [m.id === p.selectedId ? 'active' : '', ls.dragId === m.id ? 'dragging' : '', over];

  return (
    <li
      className={classes.filter(Boolean).join(' ')}
      draggable
      onClick={() => p.onSelect(m.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        ls.openMenu(m, e.clientX, e.clientY);
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', m.id);
        ls.setDragId(m.id);
      }}
      onDragEnd={() => {
        ls.setDragId(null);
        ls.setDrop(null);
      }}
      onDragOver={(e) => {
        if (!ls.dragId || ls.dragId === m.id) return;
        e.preventDefault();
        e.stopPropagation();
        // верхняя половина строки — встать перед этим макросом, нижняя — после
        const r = e.currentTarget.getBoundingClientRect();
        ls.setDrop({ kind: 'macro', id: m.id, after: e.clientY > r.top + r.height / 2 });
      }}
    >
      <span className={`dot ${running ? 'on' : ''}`} />
      <div className="macro-meta">
        <div className={`macro-name ${m.enabled ? '' : 'off'}`} title={m.enabled ? undefined : 'Горячая клавиша выключена'}>
          {m.name || 'Без названия'}
        </div>
        <div className="macro-sub">
          {m.trigger.key ? `${m.trigger.key} · ${shortMode(m.trigger.mode)}` : 'без горячей клавиши'}
          {!m.enabled && ' · выключен'}
        </div>
        {p.errors[m.id] && <div className="macro-err">⚠ {p.errors[m.id]}</div>}
      </div>
      <button
        className="play"
        title={running ? 'Остановить' : 'Запустить'}
        onClick={(e) => {
          e.stopPropagation();
          running ? api.stopMacro(m.id) : api.startMacro(m.id);
        }}
      >
        {running ? '■' : '▶'}
      </button>
    </li>
  );
}

function shortMode(m: TriggerMode): string {
  return m === 'toggle' ? 'вкл/выкл' : m === 'hold' ? 'пока зажата' : 'один раз';
}
