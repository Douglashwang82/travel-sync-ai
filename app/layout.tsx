import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TravelSync AI - Group travel from chat to action",
  description:
    "AI-powered group travel planning for LINE groups. Turn conversation into votes, expenses, reminders, and a shared trip board.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" className="h-full antialiased">
      <body id="root-body" className="flex min-h-full flex-col">
        {children}
      </body>
    </html>
  );
}
