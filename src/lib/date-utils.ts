import { addDays, addMonths, differenceInCalendarDays, format, getDay } from "date-fns";
import type { Weekday } from "./types";

export const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function toDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function monthKey(date: Date) {
  return format(date, "yyyy-MM");
}

export function getDefaultTargetMonth(date: Date) {
  return monthKey(addMonths(date, 1));
}

export function getCurrentShiftMonth(date: Date) {
  return monthKey(date.getDate() >= 21 ? addMonths(date, 1) : date);
}

export function getNextRequestShiftMonth(date: Date) {
  const currentShiftMonth = getCurrentShiftMonth(date);
  const [year, month] = currentShiftMonth.split("-").map(Number);
  return monthKey(addMonths(new Date(year, month - 1, 1), 1));
}

export function addShiftMonths(targetMonth: string, amount: number) {
  const [year, month] = targetMonth.split("-").map(Number);
  return monthKey(addMonths(new Date(year, month - 1, 1), amount));
}

export function getShiftPeriodRange(targetMonth: string) {
  const [year, month] = targetMonth.split("-").map(Number);
  return {
    end: new Date(year, month - 1, 20),
    start: new Date(year, month - 2, 21),
  };
}

export function getShiftPeriodLabel(targetMonth: string) {
  const { end, start } = getShiftPeriodRange(targetMonth);
  return `${format(start, "yyyy/M/d")}〜${format(end, "yyyy/M/d")}`;
}

export function getMonthDegreeLabel(targetMonth: string) {
  const [year, month] = targetMonth.split("-").map(Number);
  return `${year}年${month}月度`;
}

export function isDateInShiftPeriod(dateKey: string, targetMonth: string) {
  const { end, start } = getShiftPeriodRange(targetMonth);
  return dateKey >= toDateKey(start) && dateKey <= toDateKey(end);
}

export function getMonthDates(targetMonth: string) {
  const { end, start } = getShiftPeriodRange(targetMonth);
  const dates: Date[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    dates.push(day);
  }
  return dates;
}

export function getWeekOfMonth(date: Date) {
  return Math.floor((date.getDate() - 1) / 7);
}

export function getWeekOfShiftPeriod(date: Date, targetMonth: string) {
  const { start } = getShiftPeriodRange(targetMonth);
  return Math.floor(differenceInCalendarDays(date, start) / 7);
}

export function getWeekday(date: Date): Weekday {
  return getDay(date) as Weekday;
}
