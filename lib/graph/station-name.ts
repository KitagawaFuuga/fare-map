// 駅名を突き合わせるための鍵。資料ごとに表記が違うので、比較のときだけ寄せる。
//
// 実例（実営業キロのCSVとグラフで食い違っていたもの）:
//   ヶ / ケ          箱根ヶ崎・霞ヶ関・姉ヶ崎・櫛ヶ浜・柳ヶ浦・関ヶ原・駒ヶ根
//   異体字           飛驒 / 飛騨、小繫 / 小繋（Wikipedia の記事と駅データ）
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
    // 異体字。記事は「飛驒」、駅データは「飛騨」（高山本線の飛騨金山など7駅が漏れていた）
    .replace(/驒/g, "騨")
    .replace(/髙/g, "高")
    .replace(/﨑/g, "崎")
    .replace(/繫/g, "繋")
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
  // 同じ駅名の重複は衝突ではない（グラフは同じ駅を路線ぶんのノードで持つ）ので、先に畳む
  for (const name of new Set(names)) {
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

// 公式資料とグラフ（駅データ.jp）で駅名そのものが違うもの（改称など）。
// 表記揺れは matchKey で吸収できるが、別の名前になっているものはここで対応づける。
// 万葉線の西新湊は2023年9月1日に「第一イン新湊 クロスベイ前」へ改称された
// （出典: https://www.manyosen.co.jp/season/2023/95103/）。運賃表は略して「クロスベイ前」と書く。
// 駅データ.jp の2026年版でグラフ側も新しい名前になった。
export const STATION_RENAMES: Record<string, string> = {
  クロスベイ前: "第一イン新湊 クロスベイ前",
};

/**
 * 資料側の駅名をグラフ側の表記に直す関数を作る。改称を先に当て、表記揺れは
 * matchKey で吸収する。グラフに無ければ undefined。
 *
 * 特定運賃の生成（scripts/fare/derive-overrides.ts）と、その検証
 * （lib/fare/__tests__/fare-sources.test.ts）で同じ規則を使うこと。
 * 片方だけ寄せると、生成された特定運賃をテストが引けなくなる。
 */
export function graphNameResolver(
  names: Iterable<string>,
): (name: string) => string | undefined {
  const lookup = buildNameLookup(names);
  return (name) => lookup.get(matchKey(STATION_RENAMES[name] ?? name));
}
