import { DateTime, IANAZone } from "luxon";

export type ScheduleSpec = {
  type: "DAILY" | "WEEKLY" | "TRADING_DAY";
  time: string;
  timezone: string;
  weekdays?: number[];
  marketCalendar?: string;
  startAt?: string;
  endAt?: string;
};

export type TradingDayResolver = (
  date: string,
  marketCalendar: string,
) => Promise<boolean>;

export function validateScheduleSpec(schedule: ScheduleSpec) {
  const errors: string[] = [];
  if (!IANAZone.isValidZone(schedule.timezone))
    errors.push("时区不是有效的 IANA 时区");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time))
    errors.push("执行时间必须使用 HH:mm 格式");
  if (
    schedule.type === "WEEKLY" &&
    (!schedule.weekdays?.length ||
      schedule.weekdays.some((day) => day < 0 || day > 6))
  ) {
    errors.push("每周任务必须提供 0 到 6 范围内的 weekdays");
  }
  return errors;
}

export async function computeNextRunAt(
  schedule: ScheduleSpec,
  after: Date,
  isTradingDay?: TradingDayResolver,
): Promise<Date | null> {
  if (validateScheduleSpec(schedule).length) return null;
  const [hour = 0, minute = 0] = schedule.time.split(":").map(Number);
  const zone = schedule.timezone;
  let candidate = DateTime.fromJSDate(after, { zone }).set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });
  if (candidate.toJSDate() <= after) candidate = candidate.plus({ days: 1 });
  const startAt = schedule.startAt ? new Date(schedule.startAt) : null;
  const endAt = schedule.endAt ? new Date(schedule.endAt) : null;

  for (let index = 0; index < 370; index += 1) {
    const value = candidate.toJSDate();
    if (startAt && value < startAt) {
      candidate = DateTime.fromJSDate(startAt, { zone }).set({
        hour,
        minute,
        second: 0,
        millisecond: 0,
      });
      continue;
    }
    if (endAt && value > endAt) return null;
    const weekday = candidate.weekday % 7;
    if (schedule.type === "WEEKLY" && !schedule.weekdays?.includes(weekday)) {
      candidate = candidate.plus({ days: 1 });
      continue;
    }
    if (schedule.type === "TRADING_DAY") {
      if (!isTradingDay) return null;
      const open = await isTradingDay(
        candidate.toISODate() ?? "",
        schedule.marketCalendar ?? "SSE",
      );
      if (!open) {
        candidate = candidate.plus({ days: 1 });
        continue;
      }
    }
    return value;
  }
  return null;
}
