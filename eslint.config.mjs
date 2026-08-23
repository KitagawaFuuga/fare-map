import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "data/**",
      "next-env.d.ts",
      // scripts/copy-maplibre-worker.mjs が npm install / dev / build 前に node_modules からコピーする実体
      "public/maplibre-gl-worker.mjs",
      "public/maplibre-gl-shared.mjs",
    ],
  },
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
);
