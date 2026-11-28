// Probity（probity.config.ts）は Edit・Write ツールの書き込みしか見ない。Bash や PowerShell から
// sed -i やリダイレクトで書き換えると、TDD の確認を通らずに入ってしまう（2026-10-12 と 2026-11-27 に実際に起きた）。
// そうしたコマンドを PreToolUse で止め、Edit・Write で書き直すよう伝える（.claude/settings.json）。
//
// コマンドの字面で見る見張りなので、抜け道はある（変数に入れたパス、スクリプトファイルの中の書き込みなど）。
// うっかり使うのを防ぐためのもので、意図して回避するのを止めるものではない。
import { pathToFileURL } from "node:url";

// probity.config.ts の files と同じ（テストで突き合わせている）
export const GUARDED_DIRS = ["lib", "app", "components", "hooks"] as const;

const unquote = (s: string) => s.replace(/^(['"])(.*)\1$/, "$2");

// Git Bash の /c/Users/...、C:\Users\...、c:/users/... を同じ形（c:/users/...、小文字）にそろえる。
// Windows のパスは大文字小文字を区別しない
const normalizeAbsolute = (p: string) =>
  p
    .replace(/\\/g, "/")
    .replace(/^\/([a-zA-Z])\//, "$1:/")
    .replace(/\/+$/, "")
    .toLowerCase();

const isAbsolutePath = (p: string) => p.startsWith("/") || /^[A-Za-z]:/.test(p);

// リポジトリの中での相対パス（"" はリポジトリの直下）。null はリポジトリの外か、分からない場所
type Base = string | null;

// パスを、リポジトリの直下から見た形にする。外なら null。
// 絶対パスは projectDir の中のときだけ（~/.claude/hooks や、名前が前方一致する別の worktree を巻き込まない）
function relativeToProject(
  raw: string,
  base: Base,
  projectDir: string | undefined,
): string | null {
  const p = unquote(raw).replace(/\\/g, "/");
  let joined: string;
  if (isAbsolutePath(p)) {
    if (!projectDir) return null;
    const root = normalizeAbsolute(projectDir);
    const abs = normalizeAbsolute(p);
    if (abs !== root && !abs.startsWith(`${root}/`)) return null;
    joined = abs.slice(root.length);
  } else if (p.startsWith("~") || base === null) {
    return null;
  } else {
    joined = base ? `${base}/${p}` : p;
  }
  const segs: string[] = [];
  for (const s of joined.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") {
      if (segs.length === 0) return null;
      segs.pop();
    } else segs.push(s);
  }
  return segs.join("/");
}

function isGuardedIn(
  raw: string,
  base: Base,
  projectDir: string | undefined,
): boolean {
  // glob は書き込み先ではなく、設定や文字列の中のパターン
  if (raw.includes("*")) return false;
  const rel = relativeToProject(raw, base, projectDir);
  if (rel === null || rel.includes("node_modules/")) return false;
  const segs = rel.split("/");
  const dirs: readonly string[] = GUARDED_DIRS;
  return segs.length > 1 && dirs.includes(segs[0]!);
}

// ヒアドキュメントの本文は、書き込まれる中身でコマンドではない。開始の行だけ残す
const stripHeredocs = (command: string) =>
  command.replace(
    /<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g,
    "<<HEREDOC$3",
  );

const CD = /^\s*(?:cd|Set-Location|pushd)\s+("[^"]*"|'[^']*'|\S+)\s*$/i;

// 引用符の中の空白で切らないように分ける
const tokensOf = (segment: string) =>
  segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];

const args = (segment: string) =>
  tokensOf(segment).filter((t) => !t.startsWith("-"));

// 引数のどれかを書き換えるコマンド（sed -i・perl -i・PowerShell の書き込み）
const EDITS_IN_PLACE =
  /^\s*(?:sed\b.*\s-[a-zA-Z]*i|perl\b.*\s-[a-zA-Z]*i|(?:Set-Content|Add-Content|Out-File)\b)/i;
// 最後の引数が書き込み先になるコマンド
const COPIES = /^\s*(?:cp|mv|Copy-Item|Move-Item)\b/i;
// 中で書くスクリプト（node -e / python -c）。引用符で囲まれたパスを見る
const SCRIPT_WRITES =
  /writeFileSync|appendFileSync|createWriteStream|open\([^)]*,\s*['"][wa]|write_text/;

export function findShellWrite(
  command: string,
  projectDir?: string,
): string | null {
  // 相対パスは、最初はリポジトリの直下から見たものとみなし、cd のたびに見る場所を移す
  let base: Base = "";
  for (const segment of stripHeredocs(command).split(/&&|\|\||[;|\n]/)) {
    const cd = segment.match(CD);
    if (cd) {
      const target = unquote(cd[1]!);
      base =
        target === "-" ? null : relativeToProject(target, base, projectDir);
      continue;
    }
    const isGuarded = (raw: string) => isGuardedIn(raw, base, projectDir);

    // 2>/dev/null のような番号付きのリダイレクトは除く（stderr を捨てるだけ）
    for (const m of segment.matchAll(
      /(?<![0-9&>])>>?\s*("[^"]+"|'[^']+'|[^\s;|&)<]+)/g,
    ))
      if (isGuarded(m[1]!)) return unquote(m[1]!);

    const tee = segment.match(/^\s*tee\b(.*)$/);
    if (tee) {
      const hit = args(tee[1]!).find(isGuarded);
      if (hit) return unquote(hit);
    }
    if (EDITS_IN_PLACE.test(segment)) {
      const hit = args(segment).find(isGuarded);
      if (hit) return unquote(hit);
    }
    if (COPIES.test(segment)) {
      const dest = args(segment).at(-1);
      if (dest && isGuarded(dest)) return unquote(dest);
    }
    if (SCRIPT_WRITES.test(segment))
      for (const m of segment.matchAll(/(["'])([^"'\s]+)\1/g))
        if (isGuarded(m[2]!)) return m[2]!;
  }

  return null;
}

// PreToolUse フックとして動かす: 標準入力にツールの呼び出し、標準出力に判断を JSON で返す
async function main() {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const command =
    typeof input === "object" &&
    input !== null &&
    "tool_input" in input &&
    typeof input.tool_input === "object" &&
    input.tool_input !== null &&
    "command" in input.tool_input &&
    typeof input.tool_input.command === "string"
      ? input.tool_input.command
      : "";
  // 設定（.claude/settings.json）があるリポジトリの場所。相対パスはシェルの今の場所で決まるが、
  // そこまでは追わない（cd lib && sed -i ... は見逃す）
  const target = findShellWrite(
    command,
    process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  );
  if (!target) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `${target} は TDD の対象（probity.config.ts）です。シェルから書き換えると Probity の確認を通らないので、` +
          "Edit か Write ツールで書いてください。",
      },
    }),
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((e: unknown) => {
    // 見張りの不具合で作業を止めない。理由は stderr に出す
    process.stderr.write(
      `guard-shell-writes: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  });
}
