// eslint.config.js
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...Object.fromEntries(Object.keys(globals.browser).map(name => [name, "readonly"])), 
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // Require a break unless an explicit fallthrough comment is present
      "no-fallthrough": ["error", { commentPattern: "falls?\\s?through" }],
    },
  },
];
