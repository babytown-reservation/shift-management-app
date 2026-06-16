export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Staff = {
  id: string;
  authUserId?: string | null;
  email?: string | null;
  name: string;
  note: string;
  workdays: Weekday[];
  weeklyDays: number;
  monthlyMax: number;
};

export type TimeOffRequest = {
  staffId: string;
  date: string;
  memo: string;
  submittedAt?: string;
};

export type RequiredStaff = Record<string, number>;

export type ShiftAssignment = Record<string, string[]>;

export type ShiftIssue = {
  date: string;
  required: number;
  assigned: number;
};

export type ShiftResult = {
  assignments: ShiftAssignment;
  issues: ShiftIssue[];
};
