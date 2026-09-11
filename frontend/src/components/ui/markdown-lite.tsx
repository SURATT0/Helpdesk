import * as React from "react";

/**
 * The small markdown dialect this product writes in: `## ` headings, `- `
 * bullets, a blank line ends a block. Everything else is a paragraph.
 *
 * Moved here from the knowledge base when project descriptions started using the
 * same dialect. Two renderers for one syntax is how "## " quietly starts meaning
 * different things on two screens — and the KB's version was already the de
 * facto spec, so this is that code rather than a second implementation of it.
 *
 * Deliberately NOT a markdown library. The input is written by staff into a
 * textarea and rendered as React elements, never as HTML — there is no
 * `dangerouslySetInnerHTML` here and there must not be, because that is the one
 * change that would turn a project description into a way to run script in an
 * administrator's browser. Everything below emits text nodes.
 */
export function MarkdownLite({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul
        key={key++}
        className="list-disc space-y-1 pl-5 text-lead leading-relaxed text-strong"
      >
        {items.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>,
    );
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flushBullets();
      continue;
    }
    if (line.startsWith("## ")) {
      flushBullets();
      blocks.push(
        <h3 key={key++} className="text-section font-semibold text-ink">
          {line.slice(3)}
        </h3>,
      );
      continue;
    }
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      continue;
    }
    flushBullets();
    blocks.push(
      <p key={key++} className="text-lead leading-relaxed text-strong">
        {line}
      </p>,
    );
  }
  flushBullets();

  return <div className="flex flex-col gap-3">{blocks}</div>;
}
