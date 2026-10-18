/** 地図のスタイル・タイル・スプライト・グリフの配信元（components/MapView.tsx） */
export const TILE_ORIGIN = "https://tiles.openfreemap.org";

const isDev = process.env.NODE_ENV === "development";

const cspDirectives: Record<string, string> = {
  "default-src": "'self'",
  // Next.js は水和用のブートストラップを inline script で流すため 'unsafe-inline'
  // が要る。nonce を使うには proxy.ts でリクエストごとに発行する必要があり、
  // proxy は共有状態を持てない前提なので今は採らない。
  // dev の React Refresh だけ eval を使うので、開発時に限って許す。
  "script-src": `'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // Tailwind はビルド済み CSS だが、Next.js が critical CSS を inline で挿す。
  "style-src": "'self' 'unsafe-inline'",
  // maplibre はスプライトとタイルを canvas / blob 経由でも扱う。
  "img-src": `'self' data: blob: ${TILE_ORIGIN}`,
  "font-src": "'self' data:",
  "connect-src": `'self' ${TILE_ORIGIN}`,
  // setWorkerUrl("/maplibre-gl-worker.mjs") で自サイトから読むが、
  // maplibre は内部で blob ワーカーも生成する。
  "worker-src": "'self' blob:",
  "object-src": "'none'",
  "base-uri": "'none'",
  "form-action": "'self'",
  // X-Frame-Options の CSP 版。両方入れて古いブラウザにも効かせる。
  "frame-ancestors": "'none'",
};

const contentSecurityPolicy = Object.entries(cspDirectives)
  .map(([name, value]) => (value ? `${name} ${value}` : name))
  .join("; ");

export interface SecurityHeader {
  key: string;
  value: string;
}

export const securityHeaders: SecurityHeader[] = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 強い権限はどれも使っていないので閉じる（現在地ボタンは外したので geolocation も）。
  {
    key: "Permissions-Policy",
    value: "geolocation=(), camera=(), microphone=(), payment=()",
  },
];
