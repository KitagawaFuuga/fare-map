import { z } from "zod";

const EKISPERT_ENDPOINT = "https://api.ekispert.jp/v1/json/search/course/light";

const ekispertResponseSchema = z
  .object({
    ResultSet: z.object({ ResourceURI: z.string() }).optional(),
  })
  .optional();

function googleMapsUrl(fromName: string, toName: string): string {
  const p = new URLSearchParams({
    api: "1",
    origin: `${fromName}駅`,
    destination: `${toName}駅`,
    travelmode: "transit",
  });
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

// 外部 API から得た URL をクライアントの window.open() にそのまま渡すため、
// http/https スキームであることを確認してから使う（javascript: スキーム等の混入を防ぐ）
function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// 乗換案内へのリンクを作る。駅すぱあと API キーが設定されていれば正確な経路 URL を
// 取りに行き、キー未設定・通信失敗・レスポンス不正のいずれでも Google マップの
// 経路検索 URL にフォールバックする（リンクが出ないより必ず何か出るほうを優先）。
export async function buildRouteUrl(
  fromName: string,
  toName: string,
): Promise<string> {
  const key = process.env.EKISPERT_API_KEY;
  if (!key) return googleMapsUrl(fromName, toName);
  try {
    const p = new URLSearchParams({ key, from: fromName, to: toName });
    const res = await fetch(`${EKISPERT_ENDPOINT}?${p.toString()}`);
    if (!res.ok) return googleMapsUrl(fromName, toName);
    const body: unknown = await res.json();
    const parsed = ekispertResponseSchema.safeParse(body);
    const resourceUri = parsed.success
      ? parsed.data?.ResultSet?.ResourceURI
      : undefined;
    if (resourceUri && isSafeHttpUrl(resourceUri)) return resourceUri;
    return googleMapsUrl(fromName, toName);
  } catch {
    return googleMapsUrl(fromName, toName);
  }
}
