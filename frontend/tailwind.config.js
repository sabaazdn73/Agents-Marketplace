/** @type {import('tailwindcss').Config} */

// A theme role, as a Tailwind colour that still takes an alpha (bg-surface/80).
// The values live in src/index.css, once per theme.
const role = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  // 'class', not 'media': the visitor's own choice (system, light or dark)
  // decides, and it is written onto <html> by theme/ThemeProvider.jsx and by
  // the inline script in index.html. 'media' would follow the OS even after
  // someone picked the other theme.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        page: role('page'),
        surface: role('surface'),
        inset: role('inset'),
        field: role('field'),
        line: role('line'),
        'line-strong': role('line-strong'),
        fg: role('fg'),
        muted: role('muted'),
        faint: role('faint'),
        accent: role('accent'),
        'accent-fg': role('accent-fg'),
        'accent-soft': role('accent-soft'),
        pos: role('pos'),
        neg: role('neg'),
        warn: role('warn'),
        'chart-baseline': role('chart-baseline'),
      },
      // System faces only. No web-font host: fetching a font from a third
      // party would send every visitor's IP to it, which the privacy page
      // says this site does not do.
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', '"SF Mono"', 'Menlo', 'Consolas', '"Liberation Mono"', 'monospace'],
      },
      // The shell's type scale. Small base (13px), 15px section titles, one
      // 32px size for a headline figure.
      fontSize: {
        display: ['32px', { lineHeight: '40px', letterSpacing: '-0.01em' }],
        h1: ['22px', { lineHeight: '28px', letterSpacing: '-0.01em' }],
        title: ['15px', { lineHeight: '20px' }],
        body: ['13px', { lineHeight: '18px' }],
        label: ['12px', { lineHeight: '16px' }],
        micro: ['10px', { lineHeight: '12px' }],
      },
      maxWidth: {
        shell: '1328px',
      },
    },
  },
  plugins: [],
};
