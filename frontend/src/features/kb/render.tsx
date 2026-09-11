import { MarkdownLite } from "@/components/ui/markdown-lite";

/**
 * The article body.
 *
 * A thin wrapper now: the "## headings, - bullets, blank line = block" dialect
 * moved to `components/ui/markdown-lite` when project descriptions started using
 * it too. Kept as a named component rather than replacing the call sites,
 * because "the KB body" is the thing the article view is rendering — the
 * dialect it happens to be written in is an implementation detail.
 */
export function KbBody({ body }: { body: string }) {
  return <MarkdownLite text={body} />;
}
