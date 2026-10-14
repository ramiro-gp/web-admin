export const BUSINESS_TIME_ZONE = "America/Argentina/Buenos_Aires";

export type CalendarDate = string & { readonly __calendarDate: unique symbol };
export type PlanCalendar = {
  billingStart: string;
  anchorDay: number;
  frequencyMonths: number;
  endedOn?: string | null;
};

function parts(value: string): [number, number, number] {
  const [year, month, day] = value.split("-").map(Number);
  return [year!, month!, day!];
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseCalendarDate(value: string): CalendarDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Ingresá una fecha válida.");
  const [year, month, day] = parts(value);
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error("Ingresá una fecha válida.");
  }
  return value as CalendarDate;
}

function dateString(year: number, month: number, day: number): CalendarDate {
  return parseCalendarDate(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

export function today(now = new Date()): CalendarDate {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (kind: Intl.DateTimeFormatPartTypes) => formatted.find((part) => part.type === kind)!.value;
  return parseCalendarDate(`${get("year")}-${get("month")}-${get("day")}`);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = parts(parseCalendarDate(value));
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

export function addDays(value: string, amount: number): CalendarDate {
  const [year, month, day] = parts(parseCalendarDate(value));
  const result = new Date(Date.UTC(year, month - 1, day + amount));
  return dateString(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate());
}

export function addMonths(value: string, amount: number): CalendarDate {
  const [year, month, day] = parts(parseCalendarDate(value));
  const monthIndex = year * 12 + month - 1 + amount;
  const newYear = Math.floor(monthIndex / 12);
  const newMonth = (monthIndex % 12) + 1;
  return dateString(newYear, newMonth, Math.min(day, daysInMonth(newYear, newMonth)));
}

export function daysBetween(from: string, to: string): number {
  const a = parts(parseCalendarDate(from));
  const b = parts(parseCalendarDate(to));
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000);
}

export function periodBoundary(plan: PlanCalendar, index: number): CalendarDate {
  if (![1, 6, 12].includes(plan.frequencyMonths) || !Number.isInteger(plan.anchorDay) || plan.anchorDay < 1 || plan.anchorDay > 31 || !Number.isInteger(index)) {
    throw new Error("El calendario del plan no es válido.");
  }
  const [year, month] = parts(parseCalendarDate(plan.billingStart));
  const monthIndex = year * 12 + month - 1 + index * plan.frequencyMonths;
  const nextYear = Math.floor(monthIndex / 12);
  const nextMonth = monthIndex % 12 + 1;
  return dateString(nextYear, nextMonth, Math.min(plan.anchorDay, daysInMonth(nextYear, nextMonth)));
}

export function boundaryIndex(plan: PlanCalendar, value: string): number | null {
  const [startYear, startMonth] = parts(parseCalendarDate(plan.billingStart));
  const [year, month] = parts(parseCalendarDate(value));
  const monthDifference = (year - startYear) * 12 + month - startMonth;
  if (monthDifference % plan.frequencyMonths !== 0) return null;
  const index = monthDifference / plan.frequencyMonths;
  return periodBoundary(plan, index) === value ? index : null;
}

export function nextPeriodStart(plan: PlanCalendar, asOf: string = today()): CalendarDate | null {
  parseCalendarDate(asOf);
  const [startYear, startMonth] = parts(parseCalendarDate(plan.billingStart));
  const [year, month] = parts(asOf);
  let index = Math.max(0, Math.floor(((year - startYear) * 12 + month - startMonth) / plan.frequencyMonths));
  let boundary = periodBoundary(plan, index);
  if (boundary <= asOf) boundary = periodBoundary(plan, ++index);
  return plan.endedOn && boundary >= plan.endedOn ? null : boundary;
}

export function duePeriodRanges(plan: PlanCalendar, asOf: string = today()): { startsOn: CalendarDate; endsOn: CalendarDate; dueOn: CalendarDate }[] {
  parseCalendarDate(asOf);
  if (periodBoundary(plan, 0) !== plan.billingStart) throw new Error("El primer período no coincide con el día ancla.");
  const ranges: { startsOn: CalendarDate; endsOn: CalendarDate; dueOn: CalendarDate }[] = [];
  for (let index = 0; ; index++) {
    const startsOn = periodBoundary(plan, index);
    if (startsOn > asOf || (plan.endedOn && startsOn >= plan.endedOn)) break;
    const endsOn = periodBoundary(plan, index + 1);
    ranges.push({ startsOn, endsOn, dueOn: startsOn });
  }
  return ranges;
}
