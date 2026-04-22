import { TemplateDetailClient } from "@/components/app/template-detail";

export const dynamic = "force-dynamic";

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <TemplateDetailClient slug={slug} />;
}
