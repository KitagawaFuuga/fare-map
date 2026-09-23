import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  // 全パスに同じヘッダを付ける。Next.js のヘッダ設定はファイルシステムより
  // 先に評価されるので、public/ 配下の静的ファイルにも効く。
  headers: () =>
    Promise.resolve([{ source: "/:path*", headers: securityHeaders }]),
};

export default nextConfig;
