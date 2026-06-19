import type { RequiredStaff, Staff, TimeOffRequest } from "./types";

export const initialStaff: Staff[] = [
  { id: "staff-a", sortOrder: 0, name: "Aさん", note: "月〜金勤務", workdays: [1, 2, 3, 4, 5], weeklyDays: 5, monthlyMax: 22, avoidThreeConsecutive: false },
  { id: "staff-b", sortOrder: 1, name: "Bさん", note: "週3日勤務", workdays: [1, 2, 3, 4, 5], weeklyDays: 3, monthlyMax: 14, avoidThreeConsecutive: false },
  { id: "staff-c", sortOrder: 2, name: "Cさん", note: "月・水・金のみ", workdays: [1, 3, 5], weeklyDays: 3, monthlyMax: 14, avoidThreeConsecutive: false },
  { id: "staff-d", sortOrder: 3, name: "Dさん", note: "火・木中心", workdays: [2, 4, 5], weeklyDays: 2, monthlyMax: 10, avoidThreeConsecutive: false },
];

export const initialRequests: TimeOffRequest[] = [
  { staffId: "staff-b", date: "2026-06-18", memo: "通院", submittedAt: "2026-06-01T09:00:00.000Z" },
  { staffId: "staff-c", date: "2026-06-22", memo: "私用", submittedAt: "2026-06-02T09:00:00.000Z" },
];

export const defaultRequiredByWeekday: Record<number, number> = {
  1: 3,
  2: 4,
  3: 3,
  4: 4,
  5: 5,
};

export const initialRequiredStaff: RequiredStaff = {};
