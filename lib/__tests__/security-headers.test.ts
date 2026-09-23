import { describe, expect, it } from "vitest";
import { TILE_ORIGIN, securityHeaders } from "@/lib/security-headers";

const header = (key: string): string => {
  const hit = securityHeaders.find(
    (h) => h.key.toLowerCase() === key.toLowerCase(),
  );
  if (!hit) throw new Error(`${key} が securityHeaders に無い`);
  return hit.value;
};

const csp = (): Map<string, string> => {
  const directives = new Map<string, string>();
  for (const part of header("Content-Security-Policy").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(" ");
    if (idx === -1) {
      directives.set(trimmed, "");
      continue;
    }
    directives.set(trimmed.slice(0, idx), trimmed.slice(idx + 1));
  }
  return directives;
};

describe("securityHeaders", () => {
  it("クリックジャッキング対策のヘッダが入っている", () => {
    expect(header("X-Frame-Options")).toBe("DENY");
  });

  it("MIME スニッフィングを止める", () => {
    expect(header("X-Content-Type-Options")).toBe("nosniff");
  });

  it("外部サイトへ完全な URL を漏らさない Referrer-Policy になっている", () => {
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("使っていない強い権限を Permissions-Policy で無効にする", () => {
    const value = header("Permissions-Policy");
    expect(value).toContain("camera=()");
    expect(value).toContain("microphone=()");
  });

  it("現在地ボタンが使うので geolocation は自サイトにだけ許可する", () => {
    // components/LocateButton.tsx が navigator.geolocation を呼ぶ。
    // ここを camera 等と同じく () にすると現在地取得が黙って失敗する。
    expect(header("Permissions-Policy")).toContain("geolocation=(self)");
  });
});

describe("Content-Security-Policy", () => {
  it("既定では自サイトのみ許可する", () => {
    expect(csp().get("default-src")).toBe("'self'");
  });

  it("地図タイルの配信元への接続と画像取得を許可する", () => {
    // 許可しないと地図が白いまま何も出ない。
    expect(csp().get("connect-src")).toContain(TILE_ORIGIN);
    expect(csp().get("img-src")).toContain(TILE_ORIGIN);
  });

  it("maplibre のワーカーは自サイトと blob を許可する", () => {
    // setWorkerUrl("/maplibre-gl-worker.mjs") で自サイトから読むが、
    // maplibre は内部で blob ワーカーも作る。
    const value = csp().get("worker-src") ?? "";
    expect(value).toContain("'self'");
    expect(value).toContain("blob:");
  });

  it("プラグインと iframe 埋め込みを禁止する", () => {
    expect(csp().get("object-src")).toBe("'none'");
    expect(csp().get("frame-ancestors")).toBe("'none'");
  });

  it("form の送信先を自サイトに限定する", () => {
    expect(csp().get("form-action")).toBe("'self'");
  });

  it("script-src に任意のオリジンを許す指定を含めない", () => {
    const value = csp().get("script-src") ?? "";
    expect(value).not.toContain("*");
    expect(value).not.toContain("'unsafe-eval'");
  });
});
