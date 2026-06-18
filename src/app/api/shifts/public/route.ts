import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getShiftPeriodRange, toDateKey } from "@/lib/date-utils";
import type { ShiftAssignment } from "@/lib/types";

type AssignmentRow = {
  date: string;
  staff_id: string;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function toAssignments(rows: AssignmentRow[]) {
  return rows.reduce<ShiftAssignment>((acc, row) => {
    acc[row.date] = [...new Set([...(acc[row.date] ?? []), row.staff_id])];
    return acc;
  }, {});
}

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonError("Supabaseのサーバー環境変数が未設定です。", 500);
    }

    const token = getBearerToken(request);
    if (!token) return jsonError("ログイン情報を確認できません。", 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return jsonError("ログイン情報を確認できません。", 401);

    const targetMonth = new URL(request.url).searchParams.get("targetMonth")?.trim();
    if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
      return jsonError("対象月が正しくありません。");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = userData.user.email?.trim().toLowerCase() ?? "";
    const staffByUserResult = await adminClient
      .from("staff")
      .select("id")
      .eq("auth_user_id", userData.user.id)
      .limit(1)
      .maybeSingle();
    if (staffByUserResult.error) throw new Error(staffByUserResult.error.message);

    let registeredStaff = staffByUserResult.data;
    if (!registeredStaff && email) {
      const staffByEmailResult = await adminClient
        .from("staff")
        .select("id")
        .ilike("email", email)
        .limit(1)
        .maybeSingle();
      if (staffByEmailResult.error) throw new Error(staffByEmailResult.error.message);
      registeredStaff = staffByEmailResult.data;
    }
    if (!registeredStaff) return jsonError("登録済みスタッフのみ閲覧できます。", 403);

    const periodResult = await adminClient
      .from("shift_periods")
      .select("status,is_published")
      .eq("target_month", targetMonth)
      .maybeSingle();
    if (periodResult.error) throw new Error(periodResult.error.message);

    const published = periodResult.data?.status === "confirmed" && periodResult.data?.is_published === true;
    if (!published) {
      return NextResponse.json({ assignments: {}, published: false, staff: [] });
    }

    const { end, start } = getShiftPeriodRange(targetMonth);
    const [allStaffResult, assignmentsResult] = await Promise.all([
      adminClient
        .from("staff")
        .select("id,name")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      adminClient
        .from("shift_assignments")
        .select("date,staff_id")
        .gte("date", toDateKey(start))
        .lte("date", toDateKey(end))
        .order("date", { ascending: true }),
    ]);
    if (allStaffResult.error) throw new Error(allStaffResult.error.message);
    if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);

    return NextResponse.json({
      assignments: toAssignments((assignmentsResult.data ?? []) as AssignmentRow[]),
      published: true,
      staff: allStaffResult.data ?? [],
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "公開シフトを取得できませんでした。", 500);
  }
}
