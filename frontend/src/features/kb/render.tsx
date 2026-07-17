import * as React from "react";

/** Render the markdown-lite article body ("## " headings, "- " bullets, blank = block). */
export function KbBody({ body }: { body: string }) {
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
        className="list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed text-[#334155]"
      >
        {items.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>,
    );
  };

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flushBullets();
      continue;
    }
    if (line.startsWith("## ")) {
      flushBullets();
      blocks.push(
        <h3 key={key++} className="text-[14px] font-semibold text-ink">
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
      <p
        key={key++}
        className="text-[13.5px] leading-relaxed text-[#334155]"
      >
        {line}
      </p>,
    );
  }
  flushBullets();

  return <div className="flex flex-col gap-3">{blocks}</div>;
}
