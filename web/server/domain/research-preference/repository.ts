import type {
  ResearchPreferenceImportCandidate,
  ResearchPreferenceSnapshot,
  ResearchPreferenceState,
} from "~/contracts/research-preference";
import type {
  ResearchPreferenceCommand,
  ResearchPreferenceSnapshotInput,
} from "~/server/domain/research-preference/research-preference";

export interface ResearchPreferenceRepository {
  getCurrent(userId: string): Promise<ResearchPreferenceState>;
  listImportCandidates(userId: string): Promise<ResearchPreferenceImportCandidate[]>;
  applyCommand(
    userId: string,
    command: ResearchPreferenceCommand,
  ): Promise<ResearchPreferenceState>;
  createOrGetSnapshot(
    userId: string,
    input: ResearchPreferenceSnapshotInput,
    contentHash: string,
    frozenAt: Date,
  ): Promise<ResearchPreferenceSnapshot>;
  getSnapshotForUser(
    userId: string,
    snapshotId: string,
  ): Promise<ResearchPreferenceSnapshot | null>;
  deletePersonalData(userId: string, deletedAt: Date): Promise<void>;
}
