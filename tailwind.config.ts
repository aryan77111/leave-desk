import type { Config } from 'tailwindcss';

// Palette taken from xim.edu.in: deep navy primary, gold secondary.
// Bronze is darkened from the site's #CD7F32 so white text on it passes contrast.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#EEF3F8',
          100: '#D6E2EE',
          200: '#ADC4DC',
          300: '#7FA2C5',
          500: '#24598C',
          600: '#0F4A80',
          700: '#003C6F',
          800: '#002F58',
          900: '#012340',
        },
        gold: { 100: '#FBF1D9', 300: '#EFD08A', 500: '#E4B84F', 700: '#8A6514', 900: '#5C430A' },
        bronze: { 600: '#A5611F' },
        canvas: '#F5F6F8',
        line: '#E1E5EB',
        'line-strong': '#C9D0D9',
        ink: { DEFAULT: '#18202B', soft: '#3A4452', muted: '#5D6878', faint: '#8A94A3' },
        ok: { bg: '#E7F4EC', fg: '#17633D', line: '#B9DEC8' },
        warn: { bg: '#FDF3DC', fg: '#7A5200', line: '#EFD493' },
        bad: { bg: '#FCE9E7', fg: '#A3261E', line: '#F1BDB8' },
        info: { bg: '#E8F0F8', fg: '#0B4A85', line: '#BCD2E8' },
        quiet: { bg: '#EEF0F3', fg: '#4D5868', line: '#D5DAE1' },
      },
      fontFamily: {
        sans: ['"Montserrat Variable"', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.06em' }],
      },
      borderRadius: { DEFAULT: '6px' },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.04)',
        pop: '0 8px 24px rgba(16, 24, 40, 0.12)',
      },
    },
  },
  plugins: [],
};

export default config;
