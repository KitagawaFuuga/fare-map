import type { Metadata } from "next";
import { BIZ_UDPGothic } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// 駅名の数字・カナを読み分けやすい UD 書体。日本語のサブセットは無く、
// グリフが多くて先読みすると重いので preload しない
const bizUdpGothic = BIZ_UDPGothic({
  weight: ["400", "700"],
  display: "swap",
  preload: false,
});

const DESCRIPTION = "予算でどこまで行けるかを地図に表示";

// openGraph の images は書かない。app/opengraph-image.tsx が自動で og:image を足す
// （twitter:image も、twitter-image が無ければ og:image から足される）
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "fare-map",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "/",
    siteName: "fare-map",
    title: "fare-map",
    description: DESCRIPTION,
    locale: "ja_JP",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className={bizUdpGothic.className}>{children}</body>
    </html>
  );
}
