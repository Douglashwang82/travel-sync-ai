import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TravelSync AI — 多人旅遊規劃，輕鬆搞定",
  description:
    "由 AI 驅動的多人旅遊規劃工具，直接在 LINE 中使用。解析對話、發起投票、分攤費用，全程不用離開群組。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" className="h-full antialiased">
      <body id="root-body" className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
