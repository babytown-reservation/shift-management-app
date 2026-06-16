import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getShiftPeriodRange, toDateKey } from "@/lib/date-utils";
import type { ShiftAssignment } from "@/lib/types";

type SaveShiftPayload = {
  assignments?: ShiftAssignment;
  targetMonth?: string;
};

type ShiftRow = {
  date: string;
  staff_id: string;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function monthRange(targetMonth: string) {
  const { end, start } = getShiftPeriodRange(targetMonth);
  return { endDate: toDateKey(end), startDate: toDateKey(start) };
}

function normalizeDate(value: string) {
  return String(value).trim().slice(0, 10);
}

function normalizeStaffId(value: string) {
  return String(value).trim();
}

function buildRows(assignments: ShiftAssignment) {
  const rows: ShiftRow[] = [];
  const duplicateRows: ShiftRow[] = [];
  const seen = new Set<string>();
  let inputCount = 0;

  for (const [rawDate, staffIds] of Object.entries(assignments)) {
    const date = normalizeDate(rawDate);
    for (const rawStaffId of staffIds) {
      inputCount += 1;
      const staffId = normalizeStaffId(rawStaffId);
      if (!date || !staffId) continue;

      const key = `${date}:${staffId}`;
      const row = { date, staff_id: staffId };
      if (seen.has(key)) {
        duplicateRows.push(row);
        continue;
      }
      seen.add(key);
      rows.push(row);
    }
  }

  return {
    duplicateCount: duplicateRows.length,
    duplicateRows,
    inputCount,
    rows,
  };
}

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonError("Supabaseのサーバー環境変数が未設定です。", 500);
    }

    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) return jsonError("ログイン情報がありません。", 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return jsonError("ログイン情報を確認できません。", 401);
    if (userData.user.app_metadata?.role !== "admin") return jsonError("管理者のみシフトを保存できます。", 403);

    const payload = (await request.json()) as SaveShiftPayload;
    const targetMonth = payload.targetMonth?.trim();
    if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
      return jsonError("対象月が正しくありません。");
    }

    const { endDate, startDate } = monthRange(targetMonth);
    const { duplicateCount, duplicateRows, inputCount, rows } = buildRows(payload.assignments ?? {});

    console.log("[shift_assignments] delete range", { endDate, startDate, targetMonth });
    console.log("[shift_assignments] save rows", {
      duplicateCount,
      inputCount,
      rowsCount: rows.length,
      targetMonth,
    });
    console.table(rows);

    if (duplicateRows.length > 0) {
      console.log("[shift_assignments] duplicate rows", duplicateRows);
      console.table(duplicateRows);
      return jsonError(
        `保存前データに date + staff_id の重複があります: ${duplicateRows
          .map((row) => `${row.date}:${row.staff_id}`)
          .join(", ")}`,
        400,
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const deleteResult = await adminClient.from("shift_assignments").delete().gte("date", startDate).lte("date", endDate);
    if (deleteResult.error) {
      console.error("[shift_assignments] delete failed", deleteResult.error);
      throw new Error(`既存シフト削除に失敗しました: ${deleteResult.error.message}`);
    }

    const afterDeleteResult = await adminClient
      .from("shift_assignments")
      .select("date", { count: "exact", head: true })
      .gte("date", startDate)
      .lte("date", endDate);
    if (afterDeleteResult.error) {
      throw new Error(`削除後件数確認に失敗しました: ${afterDeleteResult.error.message}`);
    }

    const remainingCount = afterDeleteResult.count ?? 0;
    console.log("[shift_assignments] after delete", { remainingCount, targetMonth });
    if (remainingCount > 0) {
      throw new Error(`対象月の既存シフト削除が完了していません。残件数: ${remainingCount}`);
    }

    if (rows.length > 0) {
      const insertResult = await adminClient.from("shift_assignments").insert(rows);
      if (insertResult.error) {
        console.error("[shift_assignments] insert failed", insertResult.error);
        throw new Error(`シフト保存に失敗しました: ${insertResult.error.message}`);
      }
    }

    const afterInsertResult = await adminClient
      .from("shift_assignments")
      .select("date", { count: "exact", head: true })
      .gte("date", startDate)
      .lte("date", endDate);
    if (afterInsertResult.error) {
      throw new Error(`保存後件数確認に失敗しました: ${afterInsertResult.error.message}`);
    }

    console.log("[shift_assignments] after insert", {
      insertedRowsCount: rows.length,
      savedCount: afterInsertResult.count ?? 0,
      targetMonth,
    });

    return NextResponse.json({ rowsCount: rows.length, savedCount: afterInsertResult.count ?? 0 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "シフト保存に失敗しました。", 500);
  }
}
