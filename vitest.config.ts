import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/__tests__/**/*.test.ts"],
    // Stryker が途中で落ちると作業用のコピーが残り、その中のテストまで拾ってしまう
    exclude: [...configDefaults.exclude, ".stryker-tmp/**"],
  },
  resolve: { alias: { "@": path.resolve(__dirname) } },
});
