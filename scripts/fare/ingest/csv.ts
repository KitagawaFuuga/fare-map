// GTFS の CSV は RFC4180（引用符・埋め込みカンマ・埋め込み改行あり）なので、
// lib/graph/csv.ts の split 実装では足りない。取り込みスクリプト専用。

/** CSV を1行ずつ「見出し → 値」の連想配列にして返す */
export function parseGtfsCsv(text: string): Record<string, string>[] {
  const rows = splitRows(text.replace(/^﻿/, ""));
  const header = rows[0];
  if (header === undefined) return [];
  return rows.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function splitRows(text: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    // 空行（セルが1つで中身も空）は行として数えない
    if (!(cells.length === 1 && cells[0] === "")) rows.push(cells);
    cells = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i++;
    } else if (c === ",") {
      endCell();
      i++;
    } else if (c === "\r") {
      i++;
    } else if (c === "\n") {
      endRow();
      i++;
    } else {
      cell += c;
      i++;
    }
  }
  if (cell !== "" || cells.length > 0) endRow();
  return rows;
}
