import { getMonthDates, getWeekOfShiftPeriod, getWeekday, toDateKey } from "./date-utils";
import { isClosedDay } from "./holidays";
import type { RequiredStaff, ShiftResult, Staff, TimeOffRequest, Weekday } from "./types";

function requestKey(staffId: string, date: string) {
  return `${staffId}:${date}`;
}

type ShiftDay = {
  dateKey: string;
  needed: number;
  order: number;
  week: number;
  weekday: Weekday;
};

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
  const staffOrder = new Map(staff.map((member, index) => [member.id, index]));
  const assignments: Record<string, string[]> = {};
  const shiftDays: ShiftDay[] = [];

  getMonthDates(targetMonth).forEach((date, order) => {
    const dateKey = toDateKey(date);
    assignments[dateKey] = [];
    if (isClosedDay(date)) {
      return;
    }

    shiftDays.push({
      dateKey,
      needed: Math.max(0, required[dateKey] ?? 0),
      order,
      week: getWeekOfShiftPeriod(date, targetMonth),
      weekday: getWeekday(date),
    });
  });

  function getEligibleStaff(day: ShiftDay) {
    const assignedIds = new Set(assignments[day.dateKey]);
    return staff.filter((member) => {
      const monthly = monthCounts.get(member.id) ?? 0;
      const weekly = weekCounts.get(member.id)?.get(day.week) ?? 0;
      return (
        !assignedIds.has(member.id) &&
        member.workdays.includes(day.weekday) &&
        monthly < member.monthlyMax &&
        weekly < member.weeklyDays &&
        !requestSet.has(requestKey(member.id, day.dateKey))
      );
    });
  }

  while (true) {
    const availableDays = shiftDays
      .map((day) => ({ day, eligible: getEligibleStaff(day) }))
      .filter(({ day, eligible }) => assignments[day.dateKey].length < day.needed && eligible.length > 0)
      .sort((left, right) => {
        const leftAssigned = assignments[left.day.dateKey].length;
        const rightAssigned = assignments[right.day.dateKey].length;
        const leftRatio = left.day.needed > 0 ? leftAssigned / left.day.needed : 1;
        const rightRatio = right.day.needed > 0 ? rightAssigned / right.day.needed : 1;
        return (
          leftAssigned - rightAssigned ||
          leftRatio - rightRatio ||
          left.eligible.length - right.eligible.length ||
          left.day.order - right.day.order
        );
      });

    const selectedDay = availableDays[0];
    if (!selectedDay) break;

    const currentDayCount = assignments[selectedDay.day.dateKey].length;
    const selectedStaff = selectedDay.eligible.sort((left, right) => {
      const leftMonth = monthCounts.get(left.id) ?? 0;
      const rightMonth = monthCounts.get(right.id) ?? 0;
      const leftWeek = weekCounts.get(left.id)?.get(selectedDay.day.week) ?? 0;
      const rightWeek = weekCounts.get(right.id)?.get(selectedDay.day.week) ?? 0;
      const leftSameWeekday = weekdayCounts.get(left.id)?.get(selectedDay.day.weekday) ?? 0;
      const rightSameWeekday = weekdayCounts.get(right.id)?.get(selectedDay.day.weekday) ?? 0;
      const rotationStart = (selectedDay.day.order + currentDayCount) % Math.max(staff.length, 1);
      const leftRotation = ((staffOrder.get(left.id) ?? 0) - rotationStart + staff.length) % Math.max(staff.length, 1);
      const rightRotation = ((staffOrder.get(right.id) ?? 0) - rotationStart + staff.length) % Math.max(staff.length, 1);
      return (
        leftMonth - rightMonth ||
        leftWeek - rightWeek ||
        leftSameWeekday - rightSameWeekday ||
        leftRotation - rightRotation
      );
    })[0];

    if (!selectedStaff) break;

    assignments[selectedDay.day.dateKey].push(selectedStaff.id);
    monthCounts.set(selectedStaff.id, (monthCounts.get(selectedStaff.id) ?? 0) + 1);
    const weeks = weekCounts.get(selectedStaff.id);
    weeks?.set(selectedDay.day.week, (weeks.get(selectedDay.day.week) ?? 0) + 1);
    const weekdays = weekdayCounts.get(selectedStaff.id);
    weekdays?.set(selectedDay.day.weekday, (weekdays.get(selectedDay.day.weekday) ?? 0) + 1);
  }

  const issues = shiftDays
    .filter((day) => assignments[day.dateKey].length < day.needed)
    .map((day) => ({
      date: day.dateKey,
      required: day.needed,
      assigned: assignments[day.dateKey].length,
    }));

  return { assignments, issues };
}

export function getShiftStats(assignments: Record<string, string[]>, staff: Staff[]) {
  return staff.map((member) => ({
    staffId: member.id,
    name: member.name,
    count: Object.values(assignments).filter((ids) => ids.includes(member.id)).length,
  }));
}
