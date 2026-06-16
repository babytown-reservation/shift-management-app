import { addDays, endOfMonth, format, getDay, startOfMonth } from "date-fns";
import type { Weekday } from "./types";

export const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function toDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function monthKey(date: Date) {
  return format(date, "yyyy-MM");
}

export function getMonthDates(targetMonth: string) {
  const [year, month] = targetMonth.split("-").map(Number);
  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(start);
  const dates: Date[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    dates.push(day);
  }
  return dates;
}

export function getWeekOfMonth(date: Date) {
  return Math.floor((date.getDate() - 1) / 7);
}

export function getWeekday(date: Date): Weekday {
  return getDay(date) as Weekday;
}
