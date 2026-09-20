// ekidata.jp の CSV は引用符・カンマ埋め込みが無い素朴な形式なので split で足りる
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0]?.split(",") ?? [];
  return (
    lines
      .slice(1)
      .map((line) => {
        const cells = line.split(",");
        const row: Record<string, string> = {};
        header.forEach((h, i) => {
          row[h] = cells[i] ?? "";
        });
        return row;
      })
      // e_status は ekidata.jp の状態コード。0 以外は廃止・未開業なので落とす
      .filter((r) => !("e_status" in r) || r.e_status === "0")
  );
}
