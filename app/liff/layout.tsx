import { LiffProvider } from "@/components/liff-provider";
import { BottomNav } from "@/components/liff/bottom-nav";
import type { ReactNode } from "react";

export const metadata = {
  title: "TravelSync AI",
  description: "Group travel planning co-pilot",
};

export default function LiffLayout({ children }: { children: ReactNode }) {
  return (
    <LiffProvider>
      <div className="flex flex-col min-h-screen">
        <main className="flex-1 pb-14">{children}</main>
        <BottomNav />
      </div>
    </LiffProvider>
  );
}
