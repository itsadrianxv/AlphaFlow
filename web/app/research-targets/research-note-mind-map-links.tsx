import { ArrowUpRight, Network } from "lucide-react";
import Link from "next/link";
import type { LinkedMindMapSummary } from "~/contracts/research-target";

export function ResearchNoteMindMapLinks({
  linkedMindMaps,
}: {
  linkedMindMaps: LinkedMindMapSummary[];
}) {
  if (linkedMindMaps.length === 0) {
    return null;
  }

  return (
    <section
      className="border-l-2 border-[var(--app-border-soft)] pl-3"
      aria-label="关联思维导图"
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--app-text-strong)]">
        <Network aria-hidden="true" className="size-4" />
        <span>关联思维导图</span>
      </div>
      <ul className="grid gap-2">
        {linkedMindMaps.map((mindMap) => (
          <li key={`${mindMap.id}:${mindMap.nodeId ?? "map"}`}>
            <Link
              href={`/mind-maps/${mindMap.id}`}
              className="group inline-flex max-w-full items-start gap-1.5 text-sm text-[var(--app-text)] underline decoration-[var(--app-border)] underline-offset-4 transition-colors hover:text-[var(--app-text-strong)]"
            >
              <span className="min-w-0">
                <span className="block break-words font-medium">
                  {mindMap.title}
                </span>
                {mindMap.description ? (
                  <span className="mt-0.5 block break-words text-xs text-[var(--app-text-muted)] no-underline">
                    {mindMap.description}
                  </span>
                ) : null}
              </span>
              <ArrowUpRight
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-[var(--app-text-muted)] transition-colors group-hover:text-[var(--app-text-strong)]"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
