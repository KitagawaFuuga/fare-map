// app/icon.svg と同じ図形。出発駅（左下の点）から右上へ、運賃の段階の輪が広がる。
// 見出しの文字と並べて飾りとして使うので、読み上げからは外す
export default function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="35"
        cy="29"
        r="27"
        fill="#8c3500"
        stroke="#fff"
        strokeWidth="2"
      />
      <circle
        cx="29.5"
        cy="34.5"
        r="19.5"
        fill="#b95e04"
        stroke="#fff"
        strokeWidth="2"
      />
      <circle
        cx="24"
        cy="40"
        r="12"
        fill="#d8914e"
        stroke="#fff"
        strokeWidth="2"
      />
      <circle
        cx="20"
        cy="44"
        r="4.5"
        fill="#3b0d00"
        stroke="#fff"
        strokeWidth="2"
      />
    </svg>
  );
}
