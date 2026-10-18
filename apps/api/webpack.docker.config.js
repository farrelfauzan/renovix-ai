const { join } = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = {
  mode: 'production',
  target: 'node',
  entry: './src/main.ts',
  output: {
    path: join(__dirname, 'dist'),
    filename: 'main.js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
    alias: {
      '@generated/prisma': join(__dirname, 'src/generated/prisma'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: join(__dirname, 'tsconfig.app.json'),
            transpileOnly: true,
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  externals: [
    nodeExternals({
      modulesDir: join(__dirname, '../../node_modules'),
    }),
  ],
  // RX-170: no CopyPlugin anymore — src/assets (the static openapi.yaml) was removed with the
  // Swagger UI, so the API image ships no assets.
  plugins: [],
  optimization: {
    minimize: false,
  },
  devtool: 'source-map',
};
