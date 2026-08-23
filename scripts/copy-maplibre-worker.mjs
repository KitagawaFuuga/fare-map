// maplibre-gl はモジュールワーカーを import.meta.url からの相対パスで解決するが、
// Turbopack がバンドルしたチャンク URL は node_modules 上の相対位置と一致しないため
// ワーカーの読み込みが 404 して地図タイルが永久に読み込み中のまま止まる。
// ビルド前に public/ へ実体をコピーし、MapView 側で setWorkerUrl() させて回避する。
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "../node_modules/maplibre-gl/dist");
const destDir = resolve(here, "../public");
mkdirSync(destDir, { recursive: true });

// maplibre-gl-worker.mjs は同階層の maplibre-gl-shared.mjs を相対 import するため両方必要
for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  const src = resolve(distDir, name);
  const dest = resolve(destDir, name);
  copyFileSync(src, dest);
  console.warn(`copied ${src} -> ${dest}`);
}
