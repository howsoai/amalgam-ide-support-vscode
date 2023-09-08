/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-undef */

const path = require("path");

module.exports = async (env, options) => {
  const dev = options.mode === "development";
  const config = {
    target: "node",
    entry: {
      extension: ["./src/extension.ts"],
      debugAdapter: ["./src/debugAdapter.ts"],
    },
    devtool: "source-map",
    externals: {
      // the vscode-module is created on-the-fly and must be excluded
      vscode: "commonjs vscode",
    },
    resolve: {
      // support reading TypeScript and JavaScript files
      mainFields: ["browser", "module", "main"], // look for `browser` entry point in imported node modules
      extensions: [".ts", ".js"],
    },
    optimization: {
      minimize: !dev,
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [
            {
              loader: "ts-loader",
            },
          ],
        },
      ],
    },
    output: {
      clean: true,
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js",
      libraryTarget: "commonjs2",
      devtoolModuleFilenameTemplate: "../[resource-path]",
    },
  };

  return config;
};
