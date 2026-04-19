"""Voice transcription contracts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


ResearchVoicePageKind = Literal["quick_research", "company_research"]


class VoiceDynamicHotwordContext(BaseModel):
    query: str | None = None
    keyQuestion: str | None = None
    companyName: str | None = None
    stockCode: str | None = None
    focusConcepts: list[str] = Field(default_factory=list)
    researchGoal: str | None = None
    mustAnswerQuestions: list[str] = Field(default_factory=list)
    preferredSources: list[str] = Field(default_factory=list)
    freshnessWindowDays: int | None = None


class VoiceTranscriptionSegment(BaseModel):
    startMs: int = Field(..., ge=0)
    endMs: int = Field(..., ge=0)
    text: str
    confidence: float | None = Field(default=None, ge=0, le=1)


class VoiceTranscriptionResponse(BaseModel):
    transcript: str
    durationMs: int = Field(..., ge=0)
    overallConfidence: float = Field(..., ge=0, le=1)
    segments: list[VoiceTranscriptionSegment] = Field(default_factory=list)
