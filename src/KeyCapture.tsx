import { useEffect, useState } from 'react';
import { codeToName, mouseButtonToName } from './keys';

interface Props {
  value: string;
  onChange: (name: string) => void;
  allowMouse?: boolean;
  allowClear?: boolean;
}

/** Кнопка «нажмите клавишу»: ловит следующее нажатие и отдаёт его имя. */
export function KeyCapture({ value, onChange, allowMouse = false, allowClear = false }: Props) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const name = codeToName(e.code);
      if (name) onChange(name);
      setListening(false);
    };
    const onMouse = (e: MouseEvent) => {
      if (!allowMouse) return;
      const name = mouseButtonToName(e.button);
      if (!name) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onChange(name);
      setListening(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
    };
  }, [listening, allowMouse, onChange]);

  return (
    <div className="keycap">
      <button
        type="button"
        className={listening ? 'listening' : ''}
        onClick={() => setListening(true)}
        onBlur={() => setListening(false)}
      >
        {listening ? 'Нажмите клавишу…' : value || 'Не задана'}
      </button>
      {allowClear && value && !listening && (
        <button type="button" className="ghost" title="Убрать" onClick={() => onChange('')}>
          ×
        </button>
      )}
    </div>
  );
}
