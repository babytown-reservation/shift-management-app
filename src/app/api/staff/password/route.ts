import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type PasswordPayload = {
  password?: string;
  staffId?: string;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export async function POST(request: Request) {
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
    if (userData.user.app_metadata?.role !== "admin") {
      return jsonError("管理者のみパスワードを変更できます。", 403);
    }

    const payload = (await request.json()) as PasswordPayload;
    const staffId = payload.staffId?.trim();
    const password = payload.password?.trim();
    if (!staffId) return jsonError("スタッフを指定してください。");
    if (!password || password.length < 6) return jsonError("新しいパスワードは6文字以上で入力してください。");

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const staffResult = await adminClient
      .from("staff")
      .select("auth_user_id,email")
      .eq("id", staffId)
      .single();
    if (staffResult.error) throw new Error(staffResult.error.message);
    if (!staffResult.data.auth_user_id) {
      return jsonError("このスタッフはAuthユーザーと紐づいていません。初期パスワード登録を行ってください。");
    }

    const authUserResult = await adminClient.auth.admin.getUserById(staffResult.data.auth_user_id);
    if (authUserResult.error) throw new Error(authUserResult.error.message);
    if (authUserResult.data.user.app_metadata?.role === "admin") {
      return jsonError("管理者ユーザーのパスワードはスタッフ管理画面から変更できません。", 409);
    }

    const updateResult = await adminClient.auth.admin.updateUserById(staffResult.data.auth_user_id, {
      app_metadata: { role: "staff" },
      email: staffResult.data.email ?? undefined,
      email_confirm: true,
      password,
    });
    if (updateResult.error) throw new Error(updateResult.error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "パスワードを更新できませんでした。", 500);
  }
}
