import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Dynamic imports of Tauri modules are only discovered at runtime; pre-bundle them so dev never serves a stale optimized URL.
  optimizeDeps: { include: ['@tauri-apps/api/core', '@tauri-apps/api/path', '@tauri-apps/plugin-dialog'] },
  server: {
    port: 1420,
    strictPort: true,
    // Cargo locks files under src-tauri/target; watching them throws EBUSY on Windows.
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
