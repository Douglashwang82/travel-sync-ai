import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono, Fraunces, Noto_Serif_TC } from "next/font/google";
import "./globals.css";

const fontDisplay = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display-next",
  display: "swap",
});

// Editorial serif — the voice of the trip (hero destination, AI narrative).
// Variable font with the optical-size axis; ZH_TW falls back to Noto Serif TC
// so the editorial register survives localization.
const fontEditorial = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-editorial-next",
  display: "swap",
});

const fontSerifTC = Noto_Serif_TC({
  weight: ["500", "600", "700"],
  preload: false,
  variable: "--font-serif-tc-next",
  display: "swap",
});

const fontText = Inter({
  subsets: ["latin"],
  variable: "--font-text-next",
  display: "swap",
});

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-next",
  display: "swap",
});

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
    <html
      lang="zh-TW"
      className={`h-full antialiased ${fontDisplay.variable} ${fontText.variable} ${fontMono.variable} ${fontEditorial.variable} ${fontSerifTC.variable}`}
    >
      <body id="root-body" className="flex min-h-full flex-col">
        {children}
      </body>
    </html>
  );
}
