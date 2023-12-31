/* eslint-disable import/no-extraneous-dependencies, @typescript-eslint/no-var-requires */
const path = require('path');
const colors = require('tailwindcss/colors');

const customColors = {
  // gray: {
  //   50: '#fafafa',
  //   100: '#fafafa',
  //   200: '#F4F4F4',
  //   300: '#A1A1A1',
  //   400: '#878787',
  //   500: '#6E6E6E',
  //   600: '#545454',
  //   700: '#3B3B3B',
  //   800: '#212121',
  //   900: '#080808',
  // },
  gray: {
    50: '#F2F2F2',
    100: '#E0E0E0',
    200: '#C7C7C7',
    300: '#AEAEAE',
    400: '#959595',
    500: '#7C7C7C',
    600: '#636363',
    700: '#4A4A4A',
    800: '#313131',
    900: '#0A0A0C',
  },
  blue: {
    50: '#EAF8FD',
    100: '#D4F1FC',
    200: '#A9E4F9',
    300: '#7ED7F6',
    400: '#53CAF3',
    500: '#0ea5e9',
    600: '#0D93C6',
    700: '#0B80A3',
    800: '#096E80',
    900: '#065C5D',
  },
  nav: {
    1: '#f582ae',
    2: '#b8c1ec',
    3: '#8b78e6',
    4: '#6ab04c',
    5: '#f7d794',
  },
};

module.exports = {
  mode: 'jit',
  purge: [
    path.join(__dirname, 'src', 'components', '**', '*.{js,ts,jsx,tsx}'),
    path.join(__dirname, 'src', 'pages', '**', '*.{js,ts,jsx,tsx}'),
    path.join(__dirname, 'src', 'sections', '**', '*.{js,ts,jsx,tsx}'),
  ],
  theme: {
    fontWeight: {
      thin: 200,
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800,
      black: 900,
    },
    textShadow: {
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
          ...customColors.blue,
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
        custom:
          '0 25px 200px -12px rgba(0, 0, 0, 0.25), 0 0 600px 0 rgba(124, 224, 195, 0.5)',
        mobile:
          '0 25px 200px -12px rgba(0, 0, 0, 0.25), 0 0 600px 0 rgba(29, 78, 216, 0.5)', // Blue glow for mobile
        web: '0 25px 200px -12px rgba(0, 0, 0, 0.25), 0 0 600px 0 rgba(234, 88, 12, 0.5)', // Orange glow for web
        other:
          '0 25px 200px -12px rgba(0, 0, 0, 0.25), 0 0 600px 0 rgba(16, 185, 129, 0.5)', // Teal glow for other
      },
    },
  },
  variants: {},
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
