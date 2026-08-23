import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "fare-map",
  description: "予算でどこまで行けるかを地図に表示",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
