// 駅名を突き合わせるための鍵。資料ごとに表記が違うので、比較のときだけ寄せる。
//
// 実例（実営業キロのCSVとグラフで食い違っていたもの）:
//   ヶ / ケ          箱根ヶ崎・霞ヶ関・姉ヶ崎・櫛ヶ浜・柳ヶ浦・関ヶ原・駒ヶ根
//   全角 / 半角      ＪＲ松山駅前、羽田空港第１・第２ターミナル
//   かっこ書き       明治神宮前〈原宿〉、押上（スカイツリー前）
//   末尾の駅         松山市駅
//
// これで2,139区間のうち捨てていた79区間が35区間まで減る。グラフの全事業者で、
// 別の駅が同じ鍵に潰れることは無いのを確認済み（lib/graph/__tests__ の衝突検査は
// 事業者単位で行う前提。全国で1つに潰れても、突き合わせは事業者の中でしかしない）。
//
// 表記を寄せるのは突き合わせのときだけで、出力には必ずグラフ側の表記を使う。
// 資料側の表記をそのまま持つと、運賃を駅名で引く特定運賃が引けなくなる。
export function matchKey(name: string): string {
  const key = name
    .replace(/ヶ/g, "ケ")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/[〈（(][^〉）)]*[〉）)]/g, "")
    .trim();
  // 「駅」だけの名前を空にしてはいけない。空は何にでも一致してしまう
  const stripped = key.replace(/駅$/, "");
  return stripped === "" ? key : stripped;
}

/**
 * 資料側の駅名からグラフ側の表記を引くための表。
 * 同じ鍵に2駅以上が当たる事業者では、その鍵を捨てる（どちらか決められない）。
 */
export function buildNameLookup(names: Iterable<string>): Map<string, string> {
  const byKey = new Map<string, string[]>();
  for (const name of names) {
    const key = matchKey(name);
    byKey.set(key, [...(byKey.get(key) ?? []), name]);
  }
  const lookup = new Map<string, string>();
  for (const [key, found] of byKey) {
    const only = found[0];
    if (found.length === 1 && only !== undefined) lookup.set(key, only);
  }
  return lookup;
}
