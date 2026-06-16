import type { SupabaseClient } from "@supabase/supabase-js";
import type { RequiredStaff, ShiftAssignment, Staff, TimeOffRequest, Weekday } from "./types";

type StaffRow = {
  id: string;
  auth_user_id: string | null;
  email: string | null;
  name: string;
  note: string | null;
  workdays: number[];
  weekly_days: number;
  monthly_max: number;
};

type TimeOffRow = {
  staff_id: string;
  date: string;
  memo: string | null;
  submitted_at: string | null;
};

type RequiredRow = {
  date: string;
  required_count: number;
};

type AssignmentRow = {
  date: string;
  staff_id: string;
};

export type SupabaseStore = {
  staff: Staff[];
  requests: TimeOffRequest[];
  required: RequiredStaff;
  assignments: ShiftAssignment;
};

export type LoadScope =
  | { role: "admin" }
  | { role: "staff"; userId: string; email?: string };

function toStaff(row: StaffRow): Staff {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    email: row.email,
    name: row.name,
    note: row.note ?? "",
    workdays: row.workdays as Weekday[],
    weeklyDays: row.weekly_days,
    monthlyMax: row.monthly_max,
  };
}

function fromStaff(staff: Staff) {
  return {
    id: staff.id,
    auth_user_id: staff.authUserId ?? null,
    email: staff.email ?? null,
    name: staff.name,
    note: staff.note,
    workdays: staff.workdays,
    weekly_days: staff.weeklyDays,
    monthly_max: staff.monthlyMax,
  };
}

function toRequest(row: TimeOffRow): TimeOffRequest {
  return {
    staffId: row.staff_id,
    date: row.date,
    memo: row.memo ?? "",
    submittedAt: row.submitted_at ?? undefined,
  };
}

function toRequired(rows: RequiredRow[]): RequiredStaff {
  return Object.fromEntries(rows.map((row) => [row.date, row.required_count]));
}

function toAssignments(rows: AssignmentRow[]): ShiftAssignment {
  return rows.reduce<ShiftAssignment>((acc, row) => {
    acc[row.date] = [...new Set([...(acc[row.date] ?? []), row.staff_id])];
    return acc;
  }, {});
}

function toUniqueAssignmentRows(assignments: ShiftAssignment) {
  const seen = new Set<string>();
  let inputCount = 0;
  let duplicateCount = 0;
  const rows = Object.entries(assignments).flatMap(([date, staffIds]) => {
    return staffIds.flatMap((staffId) => {
      inputCount += 1;
      const key = `${date}:${staffId}`;
      if (seen.has(key)) {
        duplicateCount += 1;
        return [];
      }
      seen.add(key);
      return { date, staff_id: staffId };
    });
  });

  return { duplicateCount, inputCount, rows };
}

function monthRange(targetMonth: string) {
  const [year, month] = targetMonth.split("-").map(Number);
  const start = `${targetMonth}-01`;
  const end = new Date(year, month, 0).toISOString().slice(0, 10);
  return { start, end };
}

function assertResult(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadSupabaseStore(client: SupabaseClient, targetMonth: string, scope: LoadScope): Promise<SupabaseStore> {
  const { start, end } = monthRange(targetMonth);
  const staffSelect = "id,auth_user_id,email,name,note,workdays,weekly_days,monthly_max";

  if (scope.role === "staff") {
    const staffResult = await client
      .from("staff")
      .select(staffSelect)
      .limit(1)
      .maybeSingle();
    assertResult(staffResult.error);

    const staff = staffResult.data ? [toStaff(staffResult.data as StaffRow)] : [];
    const staffId = staff[0]?.id;
    if (!staffId) {
      return { staff: [], requests: [], required: {}, assignments: {} };
    }

    const [requestsResult, assignmentsResult] = await Promise.all([
      client
        .from("time_off_requests")
        .select("staff_id,date,memo,submitted_at")
        .eq("staff_id", staffId)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: true }),
      client.from("shift_assignments").select("date,staff_id").eq("staff_id", staffId).gte("date", start).lte("date", end),
    ]);

    assertResult(requestsResult.error);
    assertResult(assignmentsResult.error);

    return {
      staff,
      requests: (requestsResult.data ?? []).map((row) => toRequest(row as TimeOffRow)),
      required: {},
      assignments: toAssignments((assignmentsResult.data ?? []) as AssignmentRow[]),
    };
  }

  const [staffResult, requestsResult, requiredResult, assignmentsResult] = await Promise.all([
    client.from("staff").select(staffSelect).order("created_at", { ascending: true }),
    client
      .from("time_off_requests")
      .select("staff_id,date,memo,submitted_at")
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true }),
    client.from("required_staff").select("date,required_count").gte("date", start).lte("date", end),
    client.from("shift_assignments").select("date,staff_id").gte("date", start).lte("date", end),
  ]);

  assertResult(staffResult.error);
  assertResult(requestsResult.error);
  assertResult(requiredResult.error);
  assertResult(assignmentsResult.error);

  return {
    staff: (staffResult.data ?? []).map((row) => toStaff(row as StaffRow)),
    requests: (requestsResult.data ?? []).map((row) => toRequest(row as TimeOffRow)),
    required: toRequired((requiredResult.data ?? []) as RequiredRow[]),
    assignments: toAssignments((assignmentsResult.data ?? []) as AssignmentRow[]),
  };
}

export async function upsertStaff(client: SupabaseClient, staff: Staff) {
  const { error } = await client.from("staff").upsert(fromStaff(staff));
  assertResult(error);
}

export async function deleteStaff(client: SupabaseClient, staffId: string) {
  const { error } = await client.from("staff").delete().eq("id", staffId);
  assertResult(error);
}

export async function upsertTimeOffRequest(client: SupabaseClient, request: TimeOffRequest) {
  const { error } = await client.from("time_off_requests").upsert(
    {
      staff_id: request.staffId,
      date: request.date,
      memo: request.memo,
      submitted_at: request.submittedAt ?? new Date().toISOString(),
    },
    { onConflict: "staff_id,date" },
  );
  assertResult(error);
}

export async function deleteTimeOffRequest(client: SupabaseClient, staffId: string, date: string) {
  const { error } = await client.from("time_off_requests").delete().eq("staff_id", staffId).eq("date", date);
  assertResult(error);
}

export async function upsertRequiredStaff(client: SupabaseClient, required: RequiredStaff) {
  const rows = Object.entries(required).map(([date, requiredCount]) => ({
    date,
    required_count: requiredCount,
  }));
  if (rows.length === 0) return;
  const { error } = await client.from("required_staff").upsert(rows, { onConflict: "date" });
  assertResult(error);
}

export async function replaceMonthAssignments(client: SupabaseClient, targetMonth: string, assignments: ShiftAssignment) {
  const { start, end } = monthRange(targetMonth);
  const deleteResult = await client.from("shift_assignments").delete().gte("date", start).lte("date", end);
  assertResult(deleteResult.error);

  const { duplicateCount, inputCount, rows } = toUniqueAssignmentRows(assignments);
  console.log("[shift_assignments] save rows", {
    duplicateCount,
    inputCount,
    month: targetMonth,
    rowsCount: rows.length,
  });

  if (rows.length === 0) return;

  const { error } = await client.from("shift_assignments").upsert(rows, { onConflict: "date,staff_id" });
  assertResult(error);
}
