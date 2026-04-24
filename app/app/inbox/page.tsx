import { redirect } from "next/navigation";
import { readAppSessionCookie } from "@/lib/app-server";
import { InboxClient } from "@/components/app/inbox";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const lineUserId = await readAppSessionCookie();
  if (!lineUserId) redirect("/app/sign-in?next=/app/inbox");
  return <InboxClient />;
}
