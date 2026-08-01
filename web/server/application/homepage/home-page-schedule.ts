export function shanghaiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    hour: Number(value.hour),
    minute: Number(value.minute),
  };
}

export function homePageDueDateCandidates(now = new Date(), lookbackDays = 10) {
  const clock = shanghaiClock(now);
  const todayDue = clock.hour > 16 || (clock.hour === 16 && clock.minute >= 30);
  const anchor = new Date(`${clock.date}T00:00:00.000Z`);
  if (!todayDue) anchor.setUTCDate(anchor.getUTCDate() - 1);
  return Array.from({ length: lookbackDays }, (_, index) => {
    const candidate = new Date(anchor);
    candidate.setUTCDate(candidate.getUTCDate() - index);
    return candidate.toISOString().slice(0, 10);
  });
}
