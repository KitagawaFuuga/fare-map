// 他のコンポーネントと違い "use client" を付けていない。イベントハンドラも状態も
// 持たない純粋な表示部品なので、サーバーコンポーネントのままで問題ない
// （現状は "use client" な app/page.tsx から読まれるのでクライアント扱いになる）。
import { BRACKETS, BRACKET_COLORS, bracketLabel } from "@/lib/brackets";

export default function FareLegend() {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {/* 末尾に BRACKETS.length を足すのは「上限超え」の1段分（bracketOf と対応） */}
      {[...BRACKETS.keys(), BRACKETS.length].map((i) => (
        <span key={i} className="flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: BRACKET_COLORS[i] }}
          />
          {bracketLabel(i)}
        </span>
      ))}
    </div>
  );
}
