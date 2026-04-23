export class InvalidInsightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInsightError";
    Object.setPrototypeOf(this, InvalidInsightError.prototype);
  }
}

export class ScreeningInsightNotFoundError extends Error {
  constructor(insightId: string) {
    super(`Insight ${insightId} 不存在`);
    this.name = "ScreeningInsightNotFoundError";
    Object.setPrototypeOf(this, ScreeningInsightNotFoundError.prototype);
  }
}

export class ResearchReminderNotFoundError extends Error {
  constructor(reminderId: string) {
    super(`提醒 ${reminderId} 不存在`);
    this.name = "ResearchReminderNotFoundError";
    Object.setPrototypeOf(this, ResearchReminderNotFoundError.prototype);
  }
}
