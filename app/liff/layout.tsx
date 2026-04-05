import { LiffProvider } from "@/components/liff-provider";
import type { ReactNode } from "react";

export const metadata = {
  title: "TravelSync AI",
  description: "Group travel planning co-pilot",
};

export default function LiffLayout({ children }: { children: ReactNode }) {
  return <LiffProvider>{children}</LiffProvider>;
}
