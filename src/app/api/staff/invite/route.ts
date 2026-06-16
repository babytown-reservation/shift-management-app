import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type InvitePayload = {
  email?: string;
  name?: string;
  staffId?: string;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function findUserIdByEmail(adminClient: SupabaseClient, email: string) {
  const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
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
    if (userData.user.app_metadata?.role !== "admin") return jsonError("管理者のみ招待できます。", 403);

    const payload = (await request.json()) as InvitePayload;
    const email = payload.email?.trim().toLowerCase();
    const name = payload.name?.trim();
    const staffId = payload.staffId?.trim();
    if (!email || !name) return jsonError("スタッフ名とメールアドレスを入力してください。");

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let authUserId: string | null = null;
    const inviteResult = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { role: "staff", name },
    });

    if (inviteResult.error) {
      authUserId = await findUserIdByEmail(adminClient, email);
      if (!authUserId) throw new Error(inviteResult.error.message);
    } else {
      authUserId = inviteResult.data.user?.id ?? null;
    }

    if (!authUserId) return jsonError("Authユーザーを作成できませんでした。", 500);

    const staffPayload = {
      auth_user_id: authUserId,
      email,
      name,
    };

    const staffResult = staffId
      ? await adminClient.from("staff").update(staffPayload).eq("id", staffId).select("id,auth_user_id,email,name,note,workdays,weekly_days,monthly_max").single()
      : await adminClient
          .from("staff")
          .insert({
            ...staffPayload,
            note: "",
            workdays: [1, 2, 3, 4, 5],
            weekly_days: 3,
            monthly_max: 14,
          })
          .select("id,auth_user_id,email,name,note,workdays,weekly_days,monthly_max")
          .single();

    if (staffResult.error) throw new Error(staffResult.error.message);
    const staff = staffResult.data;

    return NextResponse.json({
      staff: {
        id: staff.id,
        authUserId: staff.auth_user_id,
        email: staff.email,
        name: staff.name,
        note: staff.note ?? "",
        workdays: staff.workdays,
        weeklyDays: staff.weekly_days,
        monthlyMax: staff.monthly_max,
      },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "スタッフ招待に失敗しました。", 500);
  }
}
