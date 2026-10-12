import { defineConfig, enforceTdd } from "@nizos/probity";

// アプリ本体だけ TDD を強制する。scripts/ や data/ の分析・生成物は対象外。
// private-rules.test.ts は事業者ごとの公式の額を並べた照合表で、行の追加はデータの
// 照合なので外す（表の1行ずつに赤を求められ、運賃表の追加が進まなかった）。
// 行を足すときは、運賃表を登録する前に汎用の表で落ちることを手で確かめる
export default defineConfig({
  rules: [
    {
      files: [
        "lib/**",
        "app/**",
        "components/**",
        "!lib/fare/__tests__/private-rules.test.ts",
      ],
      rules: [enforceTdd()],
    },
  ],
});
