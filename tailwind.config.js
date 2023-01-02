/* eslint-disable import/no-extraneous-dependencies, @typescript-eslint/no-var-requires */
const path = require('path');
const colors = require('tailwindcss/colors');

const customColors = {
  gray: {
    50: '#fafafa',
    100: '#f2f1f5',
    200: '#e2dbea',
    300: '#c3b6d0',
    400: '#a28cae',
    500: '#85688e',
    600: '#6b4c6f',
    700: '#503952',
    800: '#362637',
    900: '#1f1721',
  },

  indigo: {
    50: '#fafafa',
    100: '#f1f1f7',
    200: '#e0dbef',
    300: '#c0b6d9',
    400: '#9e8cbc',
    500: '#8267a0',
    600: '#684c81',
    700: '#4e3861',
    800: '#352641',
    900: '#1e1727',
  },

  beaver: {
    50: '#fbfbfa',
    100: '#f4f1f5',
    200: '#e8d9ea',
    300: '#cdb3cf',
    400: '#b487ad',
    500: '#98638e',
    600: '#7b476e',
    700: '#5c3551',
    800: '#3e2436',
    900: '#241620',
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
          DEFAULT: customColors.gray[500],
          ...customColors.gray,
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
  plugins: [require('tailwindcss-rtl'), require('@tailwindcss/forms')],
};
