import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type MagicLinkPayload = {
  email?: string;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonError("Supabaseのサーバー環境変数が未設定です。", 500);
    }

    const payload = (await request.json()) as MagicLinkPayload;
    const email = payload.email?.trim().toLowerCase();
    if (!email) return jsonError("メールアドレスを入力してください。");

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const staffResult = await adminClient
      .from("staff")
      .select("id,email")
      .ilike("email", email)
      .maybeSingle();
    if (staffResult.error) throw new Error(staffResult.error.message);
    if (!staffResult.data) return jsonError("登録されていないメールアドレスです。", 404);

    const publicClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
    const { error } = await publicClient.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: origin,
        shouldCreateUser: false,
      },
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "ログインリンクを送信できませんでした。", 500);
  }
}
