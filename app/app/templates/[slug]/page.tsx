import { redirect } from "next/navigation";
import { readAppSessionCookie } from "@/lib/app-server";
import { TemplateDetailClient } from "@/components/app/template-detail";

export const dynamic = "force-dynamic";

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lineUserId = await readAppSessionCookie();
  if (!lineUserId) redirect(`/app/sign-in?next=/app/templates/${slug}`);
  return <TemplateDetailClient slug={slug} viewerLineUserId={lineUserId} />;
}
