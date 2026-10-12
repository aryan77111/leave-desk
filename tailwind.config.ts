import type { Config } from 'tailwindcss';

// Leave Desk design tokens: refined institutional.
// Palette from xim.edu.in: deep navy primary, gold secondary. Bronze is darkened from the site's
// #CD7F32 so white text on it passes contrast. Source Serif 4 gives titles and figures a university's
// voice; Source Sans 3 carries the working interface. Both are self-hosted (Fontsource).
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#EEF3F8',
          100: '#D6E2EE',
          200: '#ADC4DC',
          300: '#8FAFD0',
          500: '#24598C',
          600: '#0F4A80',
          700: '#003C6F',
          800: '#002F58',
          900: '#012340',
          950: '#011A31',
        },
        gold: { 100: '#FBF1D9', 300: '#EFD08A', 500: '#E4B84F', 700: '#8A6514', 900: '#5C430A' },
        bronze: { 600: '#A5611F' },
        canvas: '#F4F6F9',
        line: '#E2E7EE',
        'line-strong': '#C8D1DC',
        ink: { DEFAULT: '#16202D', soft: '#364152', muted: '#5A6577', faint: '#8892A2' },
        ok: { bg: '#E8F4EC', fg: '#16613B', line: '#BADDC8' },
        warn: { bg: '#FDF4DE', fg: '#7A5200', line: '#EED395' },
        bad: { bg: '#FCEAE8', fg: '#A3261E', line: '#F0BEB9' },
        info: { bg: '#E9F0F8', fg: '#0B4A85', line: '#BDD2E8' },
        quiet: { bg: '#EEF1F4', fg: '#4B5667', line: '#D6DCE3' },
      },
      fontFamily: {
        sans: ['"Source Sans 3 Variable"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif 4 Variable"', 'Georgia', '"Times New Roman"', 'serif'],
      },
      // Source Sans runs smaller than Montserrat did: one step up keeps the same reading size
      // without changing any spacing.
      fontSize: {
        '2xs': ['0.75rem', { lineHeight: '1rem' }],
        xs: ['0.8125rem', { lineHeight: '1.15rem' }],
        sm: ['0.9375rem', { lineHeight: '1.4rem' }],
        base: ['1rem', { lineHeight: '1.55rem' }],
      },
      borderRadius: { DEFAULT: '6px', md: '8px', lg: '10px' },
      boxShadow: {
        // Cards are drawn with a border only; shadows are for things that float.
        card: 'none',
        pop: '0 12px 32px -8px rgba(1, 35, 64, 0.18), 0 2px 6px rgba(1, 35, 64, 0.06)',
        press: 'inset 0 1px 0 rgba(255, 255, 255, 0.10)',
      },
      transitionTimingFunction: {
        // Strong ease-out: immediate response, soft landing.
        out: 'cubic-bezier(0.23, 1, 0.32, 1)',
      },
      keyframes: {
        'rise-in': { from: { opacity: '0', transform: 'translateY(-4px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        'rise-in': 'rise-in 180ms cubic-bezier(0.23, 1, 0.32, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
