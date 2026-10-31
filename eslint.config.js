import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// No `globals` package in the workspace; list only what the code base actually uses.
const nodeGlobals = Object.fromEntries(
  [
    "process",
    "Buffer",
    "console",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "setImmediate",
    "queueMicrotask",
    "structuredClone",
    "URL",
    "URLSearchParams",
    "TextEncoder",
    "TextDecoder",
    "AbortController",
    "AbortSignal",
    "fetch",
    "Request",
    "Response",
    "Headers",
    "FormData",
    "Blob",
    "performance",
    "crypto",
    "WebSocket",
    "__dirname",
    "__filename",
  ].map((name) => [name, "readonly"]),
);
const browserGlobals = Object.fromEntries(
  [
    "window",
    "document",
    "navigator",
    "location",
    "localStorage",
    "sessionStorage",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "HTMLElement",
    "HTMLCanvasElement",
    "Element",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
    "ResizeObserver",
    "IntersectionObserver",
    "MutationObserver",
    "matchMedia",
    "getComputedStyle",
    "CustomEvent",
    "AudioContext",
    "MediaStream",
    "WebGL2RenderingContext",
    "WebGLRenderingContext",
    "OffscreenCanvas",
    "ImageData",
    "DOMRect",
    "SVGElement",
    "HTMLInputElement",
    "HTMLDivElement",
    "FileReader",
    "File",
    "BroadcastChannel",
  ].map((name) => [name, "readonly"]),
);

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/.e2e-dist/**",
    "**/out/**",
    "**/.next/**",
    "**/.next-*/**",
    "**/storybook-static/**",
    "**/coverage/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/generated/**",
    "design-references/**",
    "pnpm-lock.yaml",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...nodeGlobals, ...browserGlobals } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": "off",
    },
  },
  {
    // Classic hooks rules only. The React Compiler rules of eslint-plugin-react-hooks v7 (immutability, refs, purity,
    // set-state-in-effect) contradict the imperative React Three Fiber patterns used by the orb.
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Plain Node scripts (tooling) are not type-checked; keep them on the JS rule set.
    files: ["**/*.{js,mjs,cjs}"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);
