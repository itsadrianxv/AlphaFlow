import { v4 as uuidv4 } from "uuid";
import { InvalidInsightError } from "~/server/domain/intelligence/errors";

export type EvidenceReferenceParams = {
  id?: string;
  title: string;
  sourceName: string;
  snippet: string;
  extractedFact: string;
  url?: string;
  publishedAt?: string;
  credibilityScore?: number;
};

export class EvidenceReference {
  private readonly _id: string;
  private readonly _title: string;
  private readonly _sourceName: string;
  private readonly _snippet: string;
  private readonly _extractedFact: string;
  private readonly _url?: string;
  private readonly _publishedAt?: string;
  private readonly _credibilityScore?: number;

  private constructor(
    params: Required<
      Omit<EvidenceReferenceParams, "url" | "publishedAt" | "credibilityScore">
    > &
      Pick<EvidenceReferenceParams, "url" | "publishedAt" | "credibilityScore">,
  ) {
    this._id = params.id;
    this._title = params.title;
    this._sourceName = params.sourceName;
    this._snippet = params.snippet;
    this._extractedFact = params.extractedFact;
    this._url = params.url;
    this._publishedAt = params.publishedAt;
    this._credibilityScore = params.credibilityScore;
  }

  get id(): string {
    return this._id;
  }

  get title(): string {
    return this._title;
  }

  get sourceName(): string {
    return this._sourceName;
  }

  get snippet(): string {
    return this._snippet;
  }

  get extractedFact(): string {
    return this._extractedFact;
  }

  get url(): string | undefined {
    return this._url;
  }

  get publishedAt(): string | undefined {
    return this._publishedAt;
  }

  get credibilityScore(): number | undefined {
    return this._credibilityScore;
  }

  static create(params: EvidenceReferenceParams): EvidenceReference {
    if (!params.title.trim()) {
      throw new InvalidInsightError("证据标题不能为空");
    }

    if (!params.sourceName.trim()) {
      throw new InvalidInsightError("证据来源不能为空");
    }

    if (!params.snippet.trim()) {
      throw new InvalidInsightError("证据摘要不能为空");
    }

    if (!params.extractedFact.trim()) {
      throw new InvalidInsightError("证据事实不能为空");
    }

    if (
      params.credibilityScore !== undefined &&
      (params.credibilityScore < 0 || params.credibilityScore > 1)
    ) {
      throw new InvalidInsightError("证据可信度必须位于 0 到 1 之间");
    }

    return new EvidenceReference({
      id: params.id ?? uuidv4(),
      title: params.title.trim(),
      sourceName: params.sourceName.trim(),
      snippet: params.snippet.trim(),
      extractedFact: params.extractedFact.trim(),
      url: params.url,
      publishedAt: params.publishedAt,
      credibilityScore: params.credibilityScore,
    });
  }

  toDict(): Record<string, unknown> {
    return {
      id: this._id,
      title: this._title,
      sourceName: this._sourceName,
      snippet: this._snippet,
      extractedFact: this._extractedFact,
      url: this._url,
      publishedAt: this._publishedAt,
      credibilityScore: this._credibilityScore,
    };
  }

  static fromDict(data: Record<string, unknown>): EvidenceReference {
    return EvidenceReference.create({
      id: data.id as string | undefined,
      title: data.title as string,
      sourceName: data.sourceName as string,
      snippet: data.snippet as string,
      extractedFact: data.extractedFact as string,
      url: data.url as string | undefined,
      publishedAt: data.publishedAt as string | undefined,
      credibilityScore: data.credibilityScore as number | undefined,
    });
  }
}
