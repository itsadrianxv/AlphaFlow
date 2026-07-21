import type {
  FinancialSnapshotDto,
  ResearchArtifactDto,
  ResearchTargetNote,
  ResearchTargetRef,
  ResearchTargetSummary,
} from "~/contracts/research-target";

export type SearchMatchSource = "对象" | "最近笔记" | "财务快照" | "研究报告";

export type ResearchTargetSearchMatch = {
  source: SearchMatchSource;
  text: string;
};

export type ResearchTargetSearchResult = {
  target: ResearchTargetSummary;
  matches: ResearchTargetSearchMatch[];
};

type SearchableContent = {
  source: SearchMatchSource;
  values: Array<unknown>;
};

function asSearchText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function normalized(value: string) {
  return value.toLocaleLowerCase();
}

export function createSearchSnippet(value: string, query: string, radius = 72) {
  const trimmedValue = value.trim();
  const trimmedQuery = query.trim();
  if (!trimmedValue || !trimmedQuery) {
    return trimmedValue;
  }

  const matchIndex = normalized(trimmedValue).indexOf(normalized(trimmedQuery));
  if (
    matchIndex < 0 ||
    trimmedValue.length <= radius * 2 + trimmedQuery.length
  ) {
    return trimmedValue;
  }

  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(
    trimmedValue.length,
    matchIndex + trimmedQuery.length + radius,
  );
  return `${start > 0 ? "..." : ""}${trimmedValue.slice(start, end)}${end < trimmedValue.length ? "..." : ""}`;
}

function findMatch(content: SearchableContent, query: string) {
  const normalizedQuery = normalized(query);

  for (const value of content.values) {
    const text = asSearchText(value).trim();
    if (text && normalized(text).includes(normalizedQuery)) {
      return {
        source: content.source,
        text: createSearchSnippet(text, query),
      } satisfies ResearchTargetSearchMatch;
    }
  }

  return null;
}

function targetKey(ref: ResearchTargetRef) {
  return `${ref.type}:${ref.id}`;
}

function noteContent(note: ResearchTargetNote): SearchableContent {
  return {
    source: "最近笔记",
    values: [note.title, note.contentMarkdown, note.rawContent, note.tags],
  };
}

function snapshotContent(snapshot: FinancialSnapshotDto): SearchableContent {
  return {
    source: "财务快照",
    values: [
      snapshot.companyRefs
        .map((company) => `${company.stockName}(${company.stockCode})`)
        .join("、"),
      snapshot.metricSet,
      snapshot.periodRange,
      snapshot.rawSnapshot,
      snapshot.source,
    ],
  };
}

function artifactMarkdown(artifact: ResearchArtifactDto) {
  if (typeof artifact.payload === "string") {
    return artifact.payload;
  }

  if (
    typeof artifact.payload === "object" &&
    artifact.payload !== null &&
    !Array.isArray(artifact.payload) &&
    typeof (artifact.payload as { markdown?: unknown }).markdown === "string"
  ) {
    return (artifact.payload as { markdown: string }).markdown;
  }

  return artifact.payload;
}

function artifactContent(artifact: ResearchArtifactDto): SearchableContent {
  return {
    source: "研究报告",
    values: [artifact.title, artifactMarkdown(artifact), artifact.source],
  };
}

export function buildResearchTargetSearchResults(input: {
  query: string;
  targets: ResearchTargetSummary[];
  notes: ResearchTargetNote[];
  snapshots: FinancialSnapshotDto[];
  artifacts: ResearchArtifactDto[];
}): ResearchTargetSearchResult[] {
  const query = input.query.trim();
  if (!query) {
    return [];
  }

  const contentsByTarget = new Map<string, SearchableContent[]>();
  for (const note of input.notes) {
    const key = targetKey(note.targetRef);
    contentsByTarget.set(key, [
      ...(contentsByTarget.get(key) ?? []),
      noteContent(note),
    ]);
  }
  for (const snapshot of input.snapshots) {
    const key = targetKey(snapshot.targetRef);
    contentsByTarget.set(key, [
      ...(contentsByTarget.get(key) ?? []),
      snapshotContent(snapshot),
    ]);
  }
  for (const artifact of input.artifacts) {
    const key = targetKey(artifact.targetRef);
    contentsByTarget.set(key, [
      ...(contentsByTarget.get(key) ?? []),
      artifactContent(artifact),
    ]);
  }

  return input.targets.flatMap((target) => {
    const matches: ResearchTargetSearchMatch[] = [];
    const targetMatch = findMatch(
      {
        source: "对象",
        values: [target.label, target.description, target.tags],
      },
      query,
    );
    if (targetMatch) {
      matches.push(targetMatch);
    }

    for (const content of contentsByTarget.get(targetKey(target.ref)) ?? []) {
      const match = findMatch(content, query);
      if (match && !matches.some((item) => item.source === match.source)) {
        matches.push(match);
      }
    }

    return matches.length > 0 ? [{ target, matches }] : [];
  });
}
