import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App';
import { isPickerWindow } from './api';
import { Picker } from './Picker';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isPickerWindow() ? <Picker /> : <App />}</React.StrictMode>,
);
