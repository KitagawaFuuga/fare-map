// 本番の URL。共有したときのカード（og:image・og:url）は絶対 URL でなければならず、
// 未設定だと Next.js は localhost で組み立ててしまう。
// イメージは Azure にログインする前にビルドするので（deploy.yml）、ビルド時にホスト名を
// 引けない。Container Apps の環境を作り直してホスト名が変わったら、ここを直す
// （`az containerapp show -n fare-map -g fare-map-rg --query properties.configuration.ingress.fqdn`）
export const SITE_URL =
  "https://fare-map.grayplant-97a121c0.japaneast.azurecontainerapps.io";
