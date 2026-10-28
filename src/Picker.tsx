import { useEffect } from 'react';
import { finishPickPoint } from './api';

/** Содержимое полупрозрачного окна на весь экран: клик выбирает точку, Esc или ПКМ — отмена. */
export function Picker() {
  useEffect(() => {
    document.documentElement.classList.add('picker-mode');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finishPickPoint(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="picker"
      onMouseDown={(e) => {
        if (e.button === 0) finishPickPoint(false);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        finishPickPoint(true);
      }}
    >
      <div className="picker-hint">Кликните в нужную точку экрана · Esc или ПКМ — отмена</div>
    </div>
  );
}
