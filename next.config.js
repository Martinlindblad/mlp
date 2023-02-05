/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config) {
    config.module.rules.push({
      test: /\.svg|mp4$/i,
      issuer: /\.[jt]sx?$/,
      use: ['@svgr/webpack'],
      rules: [
        {
          test: /\.html$/i,
          loader: 'html-loader',
        },
      ],
    });

    return config;
  },
};

module.exports = nextConfig;
