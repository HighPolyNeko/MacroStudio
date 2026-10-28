import { useRef, useState } from 'react';
import { ContextMenu, MenuItem } from './ContextMenu';

/**
 * Выпадающий список в стиле приложения (системный <select> рисует список средствами Windows,
 * его не оформить). Список — то же ContextMenu, по ширине поля.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  /** [значение, подпись] */
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // клик по самому полю при открытом списке: список закрывается на mousedown,
  // и без этой метки click открыл бы его снова
  const closedAt = useRef(0);

  const close = () => {
    closedAt.current = Date.now();
    setRect(null);
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`dropdown ${rect ? 'open' : ''}`}
        onClick={() => {
          if (Date.now() - closedAt.current < 300) return;
          setRect(ref.current!.getBoundingClientRect());
        }}
      >
        <span className="dropdown-value">{options.find(([v]) => v === value)?.[1] ?? ''}</span>
        <span className="dropdown-arrow">▾</span>
      </button>
      {rect && (
        <ContextMenu x={rect.left} y={rect.bottom + 4} minWidth={rect.width} onClose={close}>
          {options.map(([v, label]) => (
            <MenuItem
              key={v}
              active={v === value}
              onClick={() => {
                onChange(v);
                close();
              }}
            >
              {label}
            </MenuItem>
          ))}
        </ContextMenu>
      )}
    </>
  );
}
