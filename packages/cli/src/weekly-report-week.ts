export const WEEKLY_REPORT_DAY_MS = 24 * 60 * 60 * 1000;

export interface IsoWeek {
  year: number;
  week: number;
}

export function isoWeekLabel(date: Date): string {
  return formatIsoWeek(isoWeekFromDate(date));
}

export function parseIsoWeekLabel(value: string): IsoWeek {
  const match = /^(?<year>\d{4})-W(?<week>\d{2})$/.exec(value);

  const yearValue = match?.groups?.year;
  const weekValue = match?.groups?.week;

  if (yearValue === undefined || weekValue === undefined) {
    throw new Error("--week must use YYYY-Www format, for example 2026-W20");
  }

  const isoWeek: IsoWeek = {
    year: Number.parseInt(yearValue, 10),
    week: Number.parseInt(weekValue, 10)
  };

  if (
    !Number.isInteger(isoWeek.year) ||
    !Number.isInteger(isoWeek.week) ||
    isoWeek.week < 1 ||
    isoWeek.week > 53 ||
    formatIsoWeek(isoWeekFromDate(isoWeekStart(isoWeek))) !== formatIsoWeek(isoWeek)
  ) {
    throw new Error(`Invalid ISO week: ${value}`);
  }

  return isoWeek;
}

export function isoWeekFromDate(date: Date): IsoWeek {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid report date");
  }

  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = target.getUTCDay() === 0 ? 7 : target.getUTCDay();

  target.setUTCDate(target.getUTCDate() + 4 - day);

  const year = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / WEEKLY_REPORT_DAY_MS + 1) / 7
  );

  return {
    year,
    week
  };
}

export function isoWeekStart(isoWeek: IsoWeek): Date {
  const fourthOfJanuary = new Date(Date.UTC(isoWeek.year, 0, 4));
  const day = fourthOfJanuary.getUTCDay() === 0 ? 7 : fourthOfJanuary.getUTCDay();
  const monday = new Date(fourthOfJanuary.getTime());

  monday.setUTCDate(fourthOfJanuary.getUTCDate() - day + 1 + (isoWeek.week - 1) * 7);
  monday.setUTCHours(0, 0, 0, 0);

  return monday;
}

export function formatIsoWeek(isoWeek: IsoWeek): string {
  return `${isoWeek.year}-W${String(isoWeek.week).padStart(2, "0")}`;
}
