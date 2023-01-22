/* eslint-disable import/no-extraneous-dependencies, @typescript-eslint/no-var-requires */
const path = require('path');
const colors = require('tailwindcss/colors');

const customColors = {
  gray: {
    50: '#fafafa',
    100: '#FFFFFF',
    200: '#F4F4F4',
    300: '#A1A1A1',
    400: '#878787',
    500: '#6E6E6E',
    600: '#545454',
    700: '#3B3B3B',
    800: '#212121',
    900: '#080808',
  },
};

module.exports = {
  content: [
    path.join(__dirname, 'src', 'components', '**', '*.{js,ts,jsx,tsx}'),
    path.join(__dirname, 'src', 'pages', '**', '*.{js,ts,jsx,tsx}'),
    path.join(__dirname, 'src', 'sections', '**', '*.{js,ts,jsx,tsx}'),
    path.join(__dirname, 'node_modules', 'flowbite', '**', '*.{js,ts,jsx,tsx}'),
  ],

  theme: {
    fontWeight: {
      hairline: 100,
      'extra-light': 100,
      thin: 200,
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800,
      'extra-bold': 800,
      black: 900,
    },
    extend: {
      container: {
        center: true,
      },
      colors: {
        primary: {
          DEFAULT: customColors.gray[500],
          ...customColors.gray,
        },
        onPrimary: {
          DEFAULT: colors.gray[100],
          50: colors.gray[900],
          100: colors.gray[900],
          200: colors.gray[900],
          300: colors.gray[900],
          400: colors.gray[900],
          500: colors.gray[100],
          600: colors.gray[100],
          700: colors.gray[100],
          800: colors.gray[100],
          900: colors.gray[100],
        },
        ...customColors,
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
  plugins: [
    require('flowbite/plugin'),
    require('tailwindcss-rtl'),
    require('@tailwindcss/forms'),
  ],
};
