import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TravelSync AI — Group travel, simplified",
  description:
    "AI-powered group travel planning that lives inside LINE. Parse chats, vote on options, split expenses — without leaving your group.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
