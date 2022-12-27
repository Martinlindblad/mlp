/* eslint-disable import/no-extraneous-dependencies, @typescript-eslint/no-var-requires */
const path = require('path');
const colors = require('tailwindcss/colors');

module.exports = {
  content: [
    path.join(__dirname, 'src', 'components', '**', '*.{js,ts,jsx,tsx}'),
    path.join(__dirname, 'src', 'pages', '**', '*.{js,ts,jsx,tsx}'),
  ],
  theme: {
    extend: {
      container: {
        center: true,
      },
      colors: {
        primary: {
          DEFAULT: colors.sky[500],
          ...colors.sky,
        },
        onPrimary: {
          DEFAULT: colors.neutral[100],
          50: colors.neutral[900],
          100: colors.neutral[900],
          200: colors.neutral[900],
          300: colors.neutral[900],
          400: colors.neutral[900],
          500: colors.neutral[100],
          600: colors.neutral[100],
          700: colors.neutral[100],
          800: colors.neutral[100],
          900: colors.neutral[100],
        },
      },
      boxShadow: {
        right: '6px 1px 7px -3px rgb(0 0 0 / 20%)',
        left: '-6px 1px 7px -3px rgb(0 0 0 / 20%)',
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [require('tailwindcss-rtl'), require('@tailwindcss/forms')],
};
