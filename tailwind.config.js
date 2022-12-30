/* eslint-disable import/no-extraneous-dependencies, @typescript-eslint/no-var-requires */
const path = require('path');
const colors = require('tailwindcss/colors');

const customColors = {
  cerise: {
    50: '#fdfcfa',
    100: '#fbf0ed',
    200: '#f8cfda',
    300: '#eea1b5',
    400: '#eb718d',
    500: '#de4e6b',
    600: '#c7344c',
    700: '#a02738',
    800: '#741b25',
    900: '#471114',
  },
  cocoa: {
    50: '#fcfbf8',
    100: '#faf0d9',
    200: '#f5d7b1',
    300: '#e7ae7d',
    400: '#da804f',
    500: '#c55d30',
    600: '#a8431f',
    700: '#823219',
    800: '#5a2313',
    900: '#39150c',
  },
  gold: {
    50: '#fbfaf4',
    100: '#f9f0bd',
    200: '#f1dd81',
    300: '#dcb84f',
    400: '#bd8e2a',
    500: '#9e6f15',
    600: '#80550d',
    700: '#62400c',
    800: '#432c0b',
    900: '#2c1b08',
  },
  navy: {
    50: '#f3f8f9',
    100: '#d9f1fa',
    200: '#aee1f5',
    300: '#7bc2e6',
    400: '#459fd2',
    500: '#337ebe',
    600: '#2b63a6',
    700: '#244b84',
    800: '#1a325e',
    900: '#101f3e',
  },
  blue: {
    50: '#f6f9fb',
    100: '#e3f0fd',
    200: '#c5d9fa',
    300: '#9db5f3',
    400: '#798eea',
    500: '#6269e3',
    600: '#514dd6',
    700: '#3e39b6',
    800: '#2b2788',
    900: '#181956',
  },
};

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
          DEFAULT: customColors.navy[500],
          ...customColors.navy,
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
