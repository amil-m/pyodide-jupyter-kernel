const path = require('path');

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  target: 'webworker',
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: 'log'
  }
};

/** @type {import('webpack').Configuration} */
const webviewConfig = {
  target: 'web',
  mode: 'none',
  entry: './webview/main.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'webview.js'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  devtool: 'nosources-source-map'
};

/** @type {import('webpack').Configuration} */
const workerConfig = {
  target: 'webworker',
  mode: 'none',
  entry: './webview/pyodide-worker.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'pyodide-worker.js'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  devtool: 'nosources-source-map'
};

module.exports = [extensionConfig, webviewConfig, workerConfig];
