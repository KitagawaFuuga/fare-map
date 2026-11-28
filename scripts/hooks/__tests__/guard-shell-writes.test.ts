import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUARDED_DIRS, findShellWrite } from "../guard-shell-writes";

describe("findShellWrite: TDD の対象のディレクトリをシェルで書き換えるコマンドを見つける", () => {
  it.each([
    ["sed -i", "sed -i 's/h3/h2/' components/StationList.tsx"],
    ["sed -i（後ろにパス）", "sed -i -e '1d' -e '2d' lib/fare/table.ts"],
    ["リダイレクト >", "echo 'x' > app/page.tsx"],
    ["リダイレクト >>", "cat a.txt >> hooks/use-reachable.ts"],
    ["./ 付きのパス", "printf x > ./lib/a.ts"],
    ["Windows の区切り", "echo x > lib\\fare\\a.ts"],
    ["tee", "echo x | tee components/a.tsx"],
    ["tee -a", "echo x | tee -a lib/a.ts"],
    ["Set-Content", "Set-Content -Path lib/a.ts -Value x"],
    ["Out-File", "'x' | Out-File app/a.tsx"],
    ["Add-Content", "Add-Content components\\a.tsx 'x'"],
    ["cp でコピーして入れる", "cp /tmp/a.ts lib/a.ts"],
    ["mv で入れる", "mv tmp.tsx components/StationList.tsx"],
    ["perl -i", "perl -pi -e 's/a/b/' lib/a.ts"],
    ["node で書く", `node -e 'require("fs").writeFileSync("lib/a.ts","x")'`],
    ["python で書く", `python -c "open('app/a.tsx','w').write('x')"`],
  ])("%s は止める", (_label, command) => {
    expect(findShellWrite(command)).not.toBeNull();
  });

  it.each([
    ["読むだけ（cat）", "cat components/StationList.tsx"],
    ["読むだけ（sed -n）", "sed -n 1,20p lib/fare/table.ts"],
    ["grep", "grep -rn 'h3' components app"],
    ["対象の外へのリダイレクト", "npm test > /tmp/out.txt"],
    ["対象を読んで外へ書く", "cat lib/a.ts > /tmp/a.ts"],
    ["e2e は対象外", "sed -i 's/3/2/' e2e/smoke.spec.ts"],
    ["scripts は対象外", "echo x > scripts/a.ts"],
    ["名前に lib を含む別のディレクトリ", "echo x > mylib/a.ts"],
    ["node_modules の中の lib", "sed -i 's/a/b/' node_modules/x/lib/a.js"],
    ["整形（prettier --write）", "npx prettier --write components/a.tsx"],
    ["lint の自動修正", "npx eslint --fix lib/a.ts"],
    ["stderr を捨てる", "ls lib 2>/dev/null"],
    ["対象から外へコピー", "cp lib/a.ts /tmp/backup.ts"],
    ["git の操作", "git add lib/a.ts components/b.tsx"],
  ])("%s は通す", (_label, command) => {
    expect(findShellWrite(command)).toBeNull();
  });

  describe("絶対パスは、このリポジトリの中のときだけ対象", () => {
    const project = String.raw`C:\Users\u\source\repos\fare-map`;
    it.each([
      ["Git Bash の形", "echo x > /c/Users/u/source/repos/fare-map/lib/a.ts"],
      [
        "Windows の形",
        String.raw`echo x > C:\Users\u\source\repos\fare-map\hooks\a.ts`,
      ],
      [
        "/ 区切りのドライブ",
        "sed -i s/a/b/ c:/users/u/source/repos/fare-map/app/page.tsx",
      ],
    ])("%s は止める", (_label, command) => {
      expect(findShellWrite(command, project)).not.toBeNull();
    });
    it.each([
      [
        "別の場所の hooks（~/.claude/hooks）",
        "echo x > /c/Users/u/.claude/hooks/a.cjs",
      ],
      [
        "名前が前方一致する別のリポジトリ",
        "echo x > /c/Users/u/source/repos/fare-map-quality/lib/a.ts",
      ],
      [
        "リポジトリの中でも対象外のディレクトリ",
        "echo x > /c/Users/u/source/repos/fare-map/e2e/a.ts",
      ],
    ])("%s は通す", (_label, command) => {
      expect(findShellWrite(command, project)).toBeNull();
    });
  });

  // 過去の会話記録のコマンドで流して見つけた誤検出（2026-11-27）
  describe("先に cd した先で判断する", () => {
    const project = "/c/Users/u/source/repos/fare-map";
    it.each([
      [
        "別のリポジトリに cd してから",
        "cd /c/Users/u/source/repos/meeting-station && sed -i '1d' lib/a.ts",
      ],
      [
        "~/.claude/hooks に cd してから",
        "cd ~/.claude/hooks && cp lib/a.cjs /tmp/a.bak; sed -i 's/a/b/' lib/a.cjs",
      ],
    ])("%s は通す", (_label, command) => {
      expect(findShellWrite(command, project)).toBeNull();
    });
    it.each([
      [
        "このリポジトリに cd してから",
        "cd /c/Users/u/source/repos/fare-map && cat >> lib/a.test.ts <<'EOF'\nx\nEOF",
      ],
      ["対象のディレクトリに cd してから", "cd lib && sed -i 's/a/b/' a.ts"],
    ])("%s は止める", (_label, command) => {
      expect(findShellWrite(command, project)).not.toBeNull();
    });
  });

  describe("ヒアドキュメントの本文はコマンドとして読まない", () => {
    it.each([
      [
        "本文にリダイレクトの字面",
        "cat > notes.md <<'EOF'\necho x > components/a.tsx\nEOF",
      ],
      [
        "本文に対象のパスの glob",
        `cat > stryker.config.mjs <<'EOF'\nmutate: ["lib/**/*.ts"],\nEOF`,
      ],
    ])("%s は通す", (_label, command) => {
      expect(findShellWrite(command)).toBeNull();
    });
    it("書き込み先が対象なら止める", () => {
      expect(findShellWrite("cat >> lib/a.test.ts <<'EOF'\nx\nEOF")).toBe(
        "lib/a.test.ts",
      );
    });
  });

  it("glob（*）は書き込み先のパスとみなさない", () => {
    expect(
      findShellWrite(`node -e 'fs.writeFileSync("x.json", "lib/**")'`),
    ).toBeNull();
  });

  it("止めたときは、書き換えようとしたパスを返す", () => {
    expect(findShellWrite("sed -i 's/a/b/' components/StationList.tsx")).toBe(
      "components/StationList.tsx",
    );
  });
});

describe("GUARDED_DIRS: Probity の対象と同じ", () => {
  it("probity.config.ts の files に並ぶディレクトリと一致する", () => {
    const config = readFileSync(
      path.resolve(__dirname, "../../../probity.config.ts"),
      "utf8",
    );
    const dirs = [...config.matchAll(/"([a-z]+)\/\*\*"/g)].map((m) => m[1]);
    expect([...GUARDED_DIRS].sort()).toEqual(dirs.sort());
  });
});
