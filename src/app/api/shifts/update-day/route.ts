import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getShiftPeriodRange, toDateKey } from "@/lib/date-utils";

type UpdateDayPayload = {
  date?: string;
  staffIds?: string[];
  targetMonth?: string;
};

type ShiftRow = {
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

function getSupabaseEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error("Supabaseのサーバー環境変数が未設定です。");
  }

  return { anonKey, serviceRoleKey, supabaseUrl };
}

async function requireAdmin(request: Request, supabaseUrl: string, anonKey: string) {
  const token = getBearerToken(request);
  if (!token) throw new Error("ログイン情報を確認できません。");

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) throw new Error("ログイン情報を確認できません。");
  if (userData.user.app_metadata?.role !== "admin") throw new Error("管理者のみシフトを保存できます。");
}

function normalizeDate(value: string) {
  return String(value).trim().slice(0, 10);
}

function normalizeStaffIds(staffIds: string[]) {
  return [...new Set(staffIds.map((staffId) => String(staffId).trim()).filter(Boolean))];
}

function isDateInTargetMonth(date: string, targetMonth: string) {
  const { end, start } = getShiftPeriodRange(targetMonth);
  return date >= toDateKey(start) && date <= toDateKey(end);
}

export async function POST(request: Request) {
  try {
    const { anonKey, serviceRoleKey, supabaseUrl } = getSupabaseEnv();
    await requireAdmin(request, supabaseUrl, anonKey);

    const payload = (await request.json()) as UpdateDayPayload;
    const targetMonth = payload.targetMonth?.trim();
    const date = payload.date ? normalizeDate(payload.date) : "";
    const staffIds = normalizeStaffIds(payload.staffIds ?? []);

    if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
      return jsonError("対象月が正しくありません。");
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonError("日付が正しくありません。");
    }
    if (!isDateInTargetMonth(date, targetMonth)) {
      return jsonError("日付が対象月度の範囲外です。");
    }

    const rows: ShiftRow[] = staffIds.map((staffId) => ({ date, staff_id: staffId }));
    console.log("[shift_assignments] update day input", {
      date,
      rowsCount: rows.length,
      staffIds,
      targetMonth,
    });

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const deleteResult = await adminClient.from("shift_assignments").delete().eq("date", date);
    if (deleteResult.error) {
      throw new Error(`対象日のシフト削除に失敗しました: ${deleteResult.error.message}`);
    }

    if (rows.length > 0) {
      const insertResult = await adminClient.from("shift_assignments").insert(rows);
      if (insertResult.error) {
        throw new Error(`対象日のシフト保存に失敗しました: ${insertResult.error.message}`);
      }
    }

    console.log("[shift_assignments] update day saved", {
      date,
      rowsCount: rows.length,
      targetMonth,
    });

    return NextResponse.json({ date, rowsCount: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "対象日のシフト保存に失敗しました。";
    const status = message.includes("管理者のみ") ? 403 : message.includes("ログイン情報") ? 401 : 500;
    return jsonError(message, status);
  }
}
