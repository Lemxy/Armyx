// Every colour is a CSS variable (src/index.css); the function keeps Tailwind's /opacity modifiers working.
const v = (name) => ({ opacityValue }) =>
  opacityValue === undefined ? `var(--${name})` : `color-mix(in srgb, var(--${name}) ${Math.round(opacityValue * 100)}%, transparent)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: Object.fromEntries(
        ['bg', 'surface', 'panel', 'field', 'line', 'line2', 'fg', 'mut', 'dim', 'accent', 'status-ok', 'status-err'].map((n) => [n, v(n)]),
      ),
      backgroundColor: { 'accent-dim': 'var(--accent-dim)' },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', 'Consolas', 'monospace'],
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        micro: ['11px', { lineHeight: '14px', letterSpacing: '0.04em' }],
        xs: ['12.5px', { lineHeight: '18px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['18px', { lineHeight: '26px' }],
        title: ['26px', { lineHeight: '32px', letterSpacing: '-0.02em' }],
      },
    },
  },
}
