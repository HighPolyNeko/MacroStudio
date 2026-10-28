import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/*
 * Общее контекстное меню: открывается в точке экрана, не вылезает за окно,
 * закрывается кликом мимо и по Esc. Подменю — <SubMenu>.
 */

/** Примерная высота подменю: если снизу не помещается — подменю открывается вверх. */
const SUBMENU_H = 240;

export function ContextMenu({
  x,
  y,
  onClose,
  children,
}: {
  /** Точка экрана (clientX/clientY), где открыть меню. */
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, flip: false, up: false });

  // сдвинуть внутрь окна, когда стал известен размер меню
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(4, Math.min(x, window.innerWidth - width - 4));
    const top = Math.max(4, Math.min(y, window.innerHeight - height - 4));
    setPos({ left, top, flip: left + width * 2 > window.innerWidth, up: top + SUBMENU_H > window.innerHeight });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as globalThis.Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`ctx-menu ${pos.flip ? 'flip' : ''} ${pos.up ? 'up' : ''}`}
      style={{ position: 'fixed', left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  onClick,
  danger = false,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

/** Пункт с подменю: открывается при наведении (или кликом). */
export function SubMenu({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-sub" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className="menu-item" onClick={() => setOpen((o) => !o)}>
        {label}
        <span className="menu-arrow">▸</span>
      </button>
      {open && <div className="ctx-menu submenu">{children}</div>}
    </div>
  );
}

export function MenuSeparator() {
  return <div className="menu-sep" />;
}
