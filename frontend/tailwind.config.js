/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', // FIXED: was defaulting to 'media' (OS preference),
  // which made dark: classes activate based on system settings
  // regardless of the app's own light/dark toggle, causing light mode
  // to render with dark-mode text/background combinations mixed in.
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
