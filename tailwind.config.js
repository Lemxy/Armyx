// Every colour is a CSS variable (src/index.css); the function keeps Tailwind's /opacity modifiers working.
// Plain utilities get opacityValue = 'var(--tw-bg-opacity)' (not a number): treat that as solid, not NaN%.
const v = (name) => ({ opacityValue }) =>
  isNaN(opacityValue) || opacityValue === undefined ? `var(--${name})` : `color-mix(in srgb, var(--${name}) ${Math.round(opacityValue * 100)}%, transparent)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: Object.fromEntries(
        ['bg', 'surface', 'panel', 'field', 'line', 'line2', 'fg', 'mut', 'dim', 'accent', 'status-ok', 'status-err'].map((n) => [n, v(n)]),
      ),
      backgroundColor: { 'accent-dim': 'var(--accent-dim)' },
      boxShadow: { float: 'var(--shadow)' },
      transitionTimingFunction: { lux: 'cubic-bezier(.22, 1, .36, 1)' },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', 'Consolas', 'monospace'],
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        micro: ['11px', { lineHeight: '15px', letterSpacing: '0.01em' }],
        xs: ['12.5px', { lineHeight: '18px' }],
        sm: ['13.5px', { lineHeight: '20px' }],
        base: ['15px', { lineHeight: '24px' }],
        title: ['28px', { lineHeight: '34px', letterSpacing: '-0.01em' }],
        display: ['64px', { lineHeight: '64px', letterSpacing: '-0.02em' }],
      },
    },
  },
}
