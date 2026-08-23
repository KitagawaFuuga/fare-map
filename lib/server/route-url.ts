const EKISPERT_ENDPOINT = "https://api.ekispert.jp/v1/json/search/course/light";

function googleMapsUrl(fromName: string, toName: string): string {
  const p = new URLSearchParams({
    api: "1",
    origin: `${fromName}駅`,
    destination: `${toName}駅`,
    travelmode: "transit",
  });
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

export async function buildRouteUrl(fromName: string, toName: string): Promise<string> {
  const key = process.env.EKISPERT_API_KEY;
  if (!key) return googleMapsUrl(fromName, toName);
  try {
    const p = new URLSearchParams({ key, from: fromName, to: toName });
    const res = await fetch(`${EKISPERT_ENDPOINT}?${p.toString()}`);
    if (!res.ok) return googleMapsUrl(fromName, toName);
    const body = (await res.json()) as { ResultSet?: { ResourceURI?: string } };
    return body.ResultSet?.ResourceURI ?? googleMapsUrl(fromName, toName);
  } catch {
    return googleMapsUrl(fromName, toName);
  }
}
