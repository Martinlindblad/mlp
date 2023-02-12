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
  nav: {
    1: '#f582ae',
    2: 'b8c1ec',
    3: '#8b78e6',
    4: '#6ab04c',
    5: '#f7d794',
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
    textShadow: {
      // defaults to {}
      default: '0 2px 5px rgba(0, 0, 0, 0.5)',
      lg: '0 2px 10px rgba(0, 0, 0, 0.5)',
    },
    extend: {
      aspectRatio: {
        '4/3': '4 / 3',
      },
      container: {
        center: true,
        padding: {
          DEFAULT: '1rem',
          sm: '1rem',
          lg: '3rem',
          xl: '4rem',
          '2xl': '5rem',
        },
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
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ['@svgr/webpack'],
    });

    return config;
  },
};
