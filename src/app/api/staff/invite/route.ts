import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type InvitePayload = {
  email?: string;
  name?: string;
  password?: string;
  staffId?: string;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const staffSelect = "id,auth_user_id,email,name,note,workdays,min_days,max_days,weekly_days,monthly_max";

async function findUserByEmail(adminClient: SupabaseClient, email: string) {
  const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
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
    const password = payload.password?.trim();
    const staffId = payload.staffId?.trim();
    if (!email || !name) return jsonError("スタッフ名とメールアドレスを入力してください。");
    if (password && password.length < 6) return jsonError("初期パスワードは6文字以上で入力してください。");

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let authUserId: string | null = null;
    if (password) {
      const createResult = await adminClient.auth.admin.createUser({
        app_metadata: { role: "staff" },
        email,
        email_confirm: true,
        password,
        user_metadata: { role: "staff", name },
      });
      if (createResult.error) {
        const existingUser = await findUserByEmail(adminClient, email);
        if (!existingUser) throw new Error(createResult.error.message);
        if (existingUser.app_metadata?.role === "admin") {
          return jsonError("管理者ユーザーのメールアドレスはスタッフ登録に使用できません。", 409);
        }
        authUserId = existingUser.id;
        const updateResult = await adminClient.auth.admin.updateUserById(existingUser.id, {
          app_metadata: { role: "staff" },
          email,
          email_confirm: true,
          password,
          user_metadata: { role: "staff", name },
        });
        if (updateResult.error) throw new Error(updateResult.error.message);
      } else {
        authUserId = createResult.data.user?.id ?? null;
      }
    } else {
      const inviteResult = await adminClient.auth.admin.inviteUserByEmail(email, {
        data: { role: "staff", name },
      });
      if (inviteResult.error) {
        const existingUser = await findUserByEmail(adminClient, email);
        if (!existingUser) throw new Error(inviteResult.error.message);
        if (existingUser.app_metadata?.role === "admin") {
          return jsonError("管理者ユーザーのメールアドレスはスタッフ登録に使用できません。", 409);
        }
        authUserId = existingUser.id;
      } else {
        authUserId = inviteResult.data.user?.id ?? null;
      }
    }

    if (!authUserId) return jsonError("Authユーザーを作成できませんでした。", 500);

    const staffPayload = {
      auth_user_id: authUserId,
      email,
      name,
    };

    const staffResult = staffId
      ? await adminClient.from("staff").update(staffPayload).eq("id", staffId).select(staffSelect).single()
      : await adminClient
          .from("staff")
          .insert({
            ...staffPayload,
            note: "",
            workdays: [1, 2, 3, 4, 5],
            min_days: 3,
            max_days: 14,
            weekly_days: 3,
            monthly_max: 14,
          })
          .select(staffSelect)
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
        weeklyDays: staff.min_days ?? staff.weekly_days,
        monthlyMax: staff.max_days ?? staff.monthly_max,
      },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "スタッフ招待に失敗しました。", 500);
  }
}
