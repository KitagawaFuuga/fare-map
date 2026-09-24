// HTML の表を二次元配列に展開する。取り込みスクリプト専用の最小実装。
//
// Wikipedia の駅一覧は rowspan / colspan を多用する（貨物駅の営業キロが2行に
// またがる、路線名の列が何行も続く、など）。列の位置がずれると営業キロを
// 別の駅のものとして読んでしまうため、span を「同じ値で埋める」形で
// 律儀に展開しておく。
//
// 対象は MediaWiki が出力する素直な表だけ。<td> の省略や不正な入れ子は扱わない。

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (whole, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return String.fromCodePoint(parseInt(body.slice(2), 16));
      }
      if (body.startsWith("#")) {
        return String.fromCodePoint(parseInt(body.slice(1), 10));
      }
      return ENTITIES[body.toLowerCase()] ?? whole;
    },
  );
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).trim();
}

const span = (attrs: string, name: string): number => {
  const m = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i").exec(attrs);
  const n = m === null ? 1 : Number(m[1]);
  // 壊れた span で行列が爆発しないよう上限を置く
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : 1;
};

/** 表ごとに、行 × 列の文字列を返す。入れ子の表はそれぞれ独立した表として返す */
export function extractTables(html: string): string[][][] {
  const tables: string[][][] = [];
  // 入れ子があるので、開始タグを見つけて対応する終了タグを数えながら取り出す
  const open = /<table\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = open.exec(html)) !== null) {
    const bodyStart = match.index + match[0].length;
    const end = findTableEnd(html, bodyStart);
    tables.push(parseRows(html.slice(bodyStart, end)));
    // 入れ子の表も拾うため、探索位置は本体の先頭に戻す
    open.lastIndex = bodyStart;
  }
  return tables.filter((t) => t.length > 0);
}

function findTableEnd(html: string, from: number): number {
  const tag = /<(\/?)table\b[^>]*>/gi;
  tag.lastIndex = from;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html)) !== null) {
    depth += match[1] === "/" ? -1 : 1;
    if (depth === 0) return match.index;
  }
  return html.length;
}

function parseRows(body: string): string[][] {
  const grid: (string | undefined)[][] = [];
  // 入れ子の表の中身を自分の行として数えないよう、内側の表は伏せる
  const flat = maskNestedTables(body);
  const rows = [...flat.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|$)/gi)];
  rows.forEach((row, rowIndex) => {
    const line = grid[rowIndex] ?? [];
    grid[rowIndex] = line;
    let column = 0;
    for (const cell of (row[1] ?? "").matchAll(
      /<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
    )) {
      const text = cellText(cell[3] ?? "");
      const colSpan = span(cell[2] ?? "", "colspan");
      const rowSpan = span(cell[2] ?? "", "rowspan");
      while (line[column] !== undefined) column++;
      for (let r = 0; r < rowSpan; r++) {
        const target = grid[rowIndex + r] ?? [];
        grid[rowIndex + r] = target;
        for (let c = 0; c < colSpan; c++) target[column + c] = text;
      }
      column += colSpan;
    }
  });
  return grid.map((row) => [...row].map((c) => c ?? ""));
}

function maskNestedTables(body: string): string {
  let out = body;
  for (;;) {
    const start = /<table\b[^>]*>/i.exec(out);
    if (start === null) return out;
    const from = start.index + start[0].length;
    const end = findTableEnd(out, from);
    const closeTag = /<\/table\s*>/i.exec(out.slice(end));
    const after = end + (closeTag === null ? 0 : closeTag[0].length);
    out = out.slice(0, start.index) + out.slice(after);
  }
}
