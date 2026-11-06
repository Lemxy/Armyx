export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#09090b', surface: '#121214', panel: '#18181b', line: '#27272a', line2: '#3f3f46',
        fg: '#f4f4f5', mut: '#a1a1aa', dim: '#71717a',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
      },
    },
  },
}
