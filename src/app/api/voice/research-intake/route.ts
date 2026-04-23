import { handleResearchVoiceIntakeRequest } from "~/modules/research/server/http/research-voice-intake-route";

export const runtime = "nodejs";

export const POST = handleResearchVoiceIntakeRequest;
