export function Logo({
  size = 28,
  showWordmark = true,
  ops = false,
}: {
  size?: number;
  showWordmark?: boolean;
  ops?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="grid place-items-center rounded-[7px] bg-brand"
        style={{ width: size, height: size }}
      >
        <svg
          width={size * 0.54}
          height={size * 0.54}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4Z" />
        </svg>
      </div>
      {showWordmark ? (
        <span className="text-[15px] font-bold tracking-[-0.01em] text-ink">
          Deskly
          {ops ? (
            <span className="ml-1.5 align-[2px] rounded bg-brand/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-brand">
              OPS
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
