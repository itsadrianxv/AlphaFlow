import type {
  ResearchPreferenceImportCandidate,
  ResearchPreferenceItem,
  ResearchPreferenceTargetType,
} from "~/contracts/research-preference";

export type ImportCandidateItem = ResearchPreferenceImportCandidate & {
  key: string;
  alreadyFollowing: boolean;
};

export type ImportCandidateGroup = {
  id: Extract<ResearchPreferenceTargetType, "COMPANY" | "INDUSTRY">;
  label: string;
  items: ImportCandidateItem[];
};

export type ResearchPreferenceImportState = {
  selectedKeys: string[];
  confirmationOpen: boolean;
  commandId: string | null;
  errorMessage: string | null;
  importedCount: number | null;
};

export function importCandidateKey(
  candidate: Pick<
    ResearchPreferenceImportCandidate,
    "targetType" | "targetKey"
  >,
) {
  return `${candidate.targetType}:${candidate.targetKey}`;
}

export function buildImportCandidateGroups(
  candidates: ResearchPreferenceImportCandidate[],
  currentItems: ResearchPreferenceItem[],
): ImportCandidateGroup[] {
  const followed = new Set(currentItems.map(importCandidateKey));
  const items = candidates.map((candidate) => ({
    ...candidate,
    key: importCandidateKey(candidate),
    alreadyFollowing: followed.has(importCandidateKey(candidate)),
  }));

  return [
    {
      id: "COMPANY",
      label: "公司",
      items: items.filter((item) => item.targetType === "COMPANY"),
    },
    {
      id: "INDUSTRY",
      label: "行业",
      items: items.filter((item) => item.targetType === "INDUSTRY"),
    },
  ].filter((group) => group.items.length > 0) as ImportCandidateGroup[];
}

export function createImportState(): ResearchPreferenceImportState {
  return {
    selectedKeys: [],
    confirmationOpen: false,
    commandId: null,
    errorMessage: null,
    importedCount: null,
  };
}

export function reconcileImportSelection(
  state: ResearchPreferenceImportState,
  groups: ImportCandidateGroup[],
): ResearchPreferenceImportState {
  const selectableKeys = new Set(
    groups
      .flatMap((group) => group.items)
      .filter((item) => !item.alreadyFollowing)
      .map((item) => item.key),
  );
  const selectedKeys = state.selectedKeys.filter((key) =>
    selectableKeys.has(key),
  );
  if (selectedKeys.length === 0 && state.confirmationOpen) {
    return {
      ...state,
      selectedKeys,
      confirmationOpen: false,
      commandId: null,
      errorMessage: null,
    };
  }
  return {
    ...state,
    selectedKeys,
  };
}

export function toggleImportCandidate(
  state: ResearchPreferenceImportState,
  key: string,
): ResearchPreferenceImportState {
  const selected = new Set(state.selectedKeys);
  if (selected.has(key)) selected.delete(key);
  else selected.add(key);
  return {
    ...state,
    selectedKeys: [...selected],
    importedCount: null,
  };
}

export function selectImportGroup(
  state: ResearchPreferenceImportState,
  group: ImportCandidateGroup,
  selected: boolean,
): ResearchPreferenceImportState {
  const next = new Set(state.selectedKeys);
  for (const item of group.items) {
    if (item.alreadyFollowing) continue;
    if (selected) next.add(item.key);
    else next.delete(item.key);
  }
  return { ...state, selectedKeys: [...next], importedCount: null };
}

export function beginImportConfirmation(
  state: ResearchPreferenceImportState,
  commandId: string,
): ResearchPreferenceImportState {
  if (state.selectedKeys.length === 0) return state;
  return {
    ...state,
    confirmationOpen: true,
    commandId,
    errorMessage: null,
  };
}

export function cancelImportConfirmation(
  state: ResearchPreferenceImportState,
): ResearchPreferenceImportState {
  return {
    ...state,
    confirmationOpen: false,
    commandId: null,
    errorMessage: null,
  };
}

export function getImportSubmission(
  state: ResearchPreferenceImportState,
  groups: ImportCandidateGroup[],
) {
  if (!state.confirmationOpen || !state.commandId) return null;
  const selected = new Set(state.selectedKeys);
  const items = groups
    .flatMap((group) => group.items)
    .filter((item) => selected.has(item.key) && !item.alreadyFollowing);
  if (items.length === 0) return null;

  const companies = items.filter(
    (item) => item.targetType === "COMPANY",
  ).length;
  const industries = items.filter(
    (item) => item.targetType === "INDUSTRY",
  ).length;
  return {
    commandId: state.commandId,
    targets: items.map(({ targetType, targetKey }) => ({
      targetType,
      targetKey,
    })),
    summary: { companies, industries, total: items.length },
  };
}

export async function executeResearchPreferenceImport({
  state,
  groups,
  currentItems,
  importTargets,
  refresh,
}: {
  state: ResearchPreferenceImportState;
  groups: ImportCandidateGroup[];
  currentItems: ResearchPreferenceItem[];
  importTargets: (input: {
    commandId: string;
    targets: Array<{
      targetType: ResearchPreferenceTargetType;
      targetKey: string;
    }>;
  }) => Promise<{ items: ResearchPreferenceItem[] }>;
  refresh: () => Promise<unknown>;
}): Promise<ResearchPreferenceImportState> {
  const submission = getImportSubmission(state, groups);
  if (!submission) return state;

  try {
    const previousKeys = new Set(currentItems.map(importCandidateKey));
    const result = await importTargets({
      commandId: submission.commandId,
      targets: submission.targets,
    });
    const resultKeys = new Set(result.items.map(importCandidateKey));
    const importedCount = submission.targets.filter((target) => {
      const key = importCandidateKey(target);
      return !previousKeys.has(key) && resultKeys.has(key);
    }).length;
    await refresh();
    return succeedImport(state, importedCount);
  } catch (error) {
    return failImport(
      state,
      error instanceof Error ? error.message : "导入失败，请重试。",
    );
  }
}

export function failImport(
  state: ResearchPreferenceImportState,
  errorMessage: string,
): ResearchPreferenceImportState {
  return { ...state, errorMessage };
}

export function succeedImport(
  _state: ResearchPreferenceImportState,
  importedCount: number,
): ResearchPreferenceImportState {
  return {
    ...createImportState(),
    importedCount,
  };
}
