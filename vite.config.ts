import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // 127.0.0.1, а не localhost: Node 17+ резолвит localhost в ::1, а Tauri ждёт IPv4.
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: { target: 'es2021' },
});
