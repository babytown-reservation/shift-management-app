import { getMonthDates, getWeekOfMonth, getWeekday, toDateKey } from "./date-utils";
import { isClosedDay } from "./holidays";
import type { RequiredStaff, ShiftResult, Staff, TimeOffRequest } from "./types";

function requestKey(staffId: string, date: string) {
  return `${staffId}:${date}`;
}

export function generateShift(
  targetMonth: string,
  staff: Staff[],
  requests: TimeOffRequest[],
  required: RequiredStaff,
): ShiftResult {
  const requestSet = new Set(requests.map((request) => requestKey(request.staffId, request.date)));
  const monthCounts = new Map(staff.map((member) => [member.id, 0]));
  const weekCounts = new Map(staff.map((member) => [member.id, new Map<number, number>()]));
  const weekdayCounts = new Map(staff.map((member) => [member.id, new Map<number, number>()]));
  const assignments: Record<string, string[]> = {};
  const issues = [];

  for (const date of getMonthDates(targetMonth)) {
    const dateKey = toDateKey(date);
    if (isClosedDay(date)) {
      assignments[dateKey] = [];
      continue;
    }

    const weekday = getWeekday(date);
    const week = getWeekOfMonth(date);
    const needed = required[dateKey] ?? 0;
    const eligible = staff
      .filter((member) => {
        const monthly = monthCounts.get(member.id) ?? 0;
        const weekly = weekCounts.get(member.id)?.get(week) ?? 0;
        return (
          member.workdays.includes(weekday) &&
          monthly < member.monthlyMax &&
          weekly < member.weeklyDays &&
          !requestSet.has(requestKey(member.id, dateKey))
        );
      })
      .sort((left, right) => {
        const leftMonth = monthCounts.get(left.id) ?? 0;
        const rightMonth = monthCounts.get(right.id) ?? 0;
        const leftWeek = weekCounts.get(left.id)?.get(week) ?? 0;
        const rightWeek = weekCounts.get(right.id)?.get(week) ?? 0;
        const leftSameWeekday = weekdayCounts.get(left.id)?.get(weekday) ?? 0;
        const rightSameWeekday = weekdayCounts.get(right.id)?.get(weekday) ?? 0;
        return leftMonth - rightMonth || leftWeek - rightWeek || leftSameWeekday - rightSameWeekday;
      });

    const selected = eligible.slice(0, needed);
    assignments[dateKey] = selected.map((member) => member.id);

    for (const member of selected) {
      monthCounts.set(member.id, (monthCounts.get(member.id) ?? 0) + 1);
      const weeks = weekCounts.get(member.id);
      weeks?.set(week, (weeks.get(week) ?? 0) + 1);
      const weekdays = weekdayCounts.get(member.id);
      weekdays?.set(weekday, (weekdays.get(weekday) ?? 0) + 1);
    }

    if (selected.length < needed) {
      issues.push({ date: dateKey, required: needed, assigned: selected.length });
    }
  }

  return { assignments, issues };
}

export function getShiftStats(assignments: Record<string, string[]>, staff: Staff[]) {
  return staff.map((member) => ({
    staffId: member.id,
    name: member.name,
    count: Object.values(assignments).filter((ids) => ids.includes(member.id)).length,
  }));
}
