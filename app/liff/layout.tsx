import { LiffProvider } from "@/components/liff-provider";
import { BottomNav } from "@/components/liff/bottom-nav";
import type { ReactNode } from "react";

export const metadata = {
  title: "TravelSync AI",
  description: "Group travel planning co-pilot",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function LiffLayout({ children }: { children: ReactNode }) {
  return (
    <LiffProvider>
      {/*
        pb-14 reserves space for the 56px (h-14) fixed bottom nav.
        An additional env(safe-area-inset-bottom) is applied by BottomNav itself.
      */}
      <div
        className="flex flex-col min-h-screen"
        style={{ paddingBottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {children}
      </div>
      <BottomNav />
    </LiffProvider>
  );
}
