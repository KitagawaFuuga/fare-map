import { ImageResponse } from "next/og";

// URL を共有したときのカードの画像。ビルド時に一度だけ描いて、静的な PNG として配る。
// ImageResponse の既定のフォントには日本語の字形が無く、日本語を描くと豆腐になる。
// フォントを同梱すると重いので、画像にはロゴと英字の名前だけを描き、
// 日本語の説明は og:title・og:description（共有先が描く）に任せる
export const alt = "fare-map のロゴ";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// app/icon.svg と同じ図形・色
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<circle cx="35" cy="29" r="27" fill="#8c3500" stroke="#fff" stroke-width="2"/>
<circle cx="29.5" cy="34.5" r="19.5" fill="#b95e04" stroke="#fff" stroke-width="2"/>
<circle cx="24" cy="40" r="12" fill="#d8914e" stroke="#fff" stroke-width="2"/>
<circle cx="20" cy="44" r="4.5" fill="#3b0d00" stroke="#fff" stroke-width="2"/>
</svg>`;

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 48,
        background: "#fff7ef",
      }}
    >
      {/* ImageResponse は next/image を描けないので img を使う */}
      <img
        src={`data:image/svg+xml,${encodeURIComponent(LOGO)}`}
        width={280}
        height={280}
        alt=""
      />
      <div style={{ fontSize: 120, fontWeight: 700, color: "#3b0d00" }}>
        fare-map
      </div>
    </div>,
    size,
  );
}
