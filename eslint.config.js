import js from "@eslint/js";
import babelParser from "@babel/eslint-parser";

export default [
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      "research/image-reduction/results/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        MessageChannel: "readonly",
        Request: "readonly",
        Response: "readonly",
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "*.ts"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { parserOpts: { plugins: ["typescript", "jsx"] } },
      },
    },
    // TypeScript 7 owns symbol resolution and unused checks. Babel parses syntax;
    // the native semantic gate checks promises and resolved import boundaries.
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-redeclare": "off",
      "no-dupe-class-members": "off",
      "no-unused-expressions": "error",
    },
  },
];
