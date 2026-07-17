import { Topbar } from "@/components/layout/topbar";
import { KbBrowser } from "@/features/kb/components/kb-browser";

export default function KnowledgeBasePage() {
  return (
    <>
      <Topbar titleKey="nav.kb" showSearch={false} />
      <main className="flex-1 overflow-y-auto">
        <KbBrowser />
      </main>
    </>
  );
}
