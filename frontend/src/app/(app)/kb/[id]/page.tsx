import { Topbar } from "@/components/layout/topbar";
import { KbArticleView } from "@/features/kb/components/kb-article-view";

export default async function KbArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <Topbar titleKey="nav.kb" showSearch={false} />
      <main className="flex-1 overflow-y-auto">
        <KbArticleView id={id} />
      </main>
    </>
  );
}
