const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  resolve: {
    alias: {
      '@generated/prisma': join(__dirname, 'src/generated/prisma'),
    },
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      // RX-170: no assets folder anymore (the static openapi.yaml was removed with the Swagger UI).
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    })
  ],
};
