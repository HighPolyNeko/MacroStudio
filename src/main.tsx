import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App';
import { isPickerWindow } from './api';
import { Picker } from './Picker';

// Без стандартного меню браузера (Назад, Обновить, Печать…) по правой кнопке.
// В полях ввода оставляем — там «Вырезать / Копировать / Вставить».
document.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement | null;
  if (!t?.closest('input, textarea, [contenteditable="true"]')) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isPickerWindow() ? <Picker /> : <App />}</React.StrictMode>,
);
