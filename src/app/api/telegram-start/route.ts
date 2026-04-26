import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const telegramBotUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.replace(/^@/, "");

type TelegramRequest = {
  id: string;
  token: string;
  mode: "signin" | "link";
  user_id: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  telegram_photo_url: string | null;
  status: "pending" | "completed" | "error";
  error: string | null;
  expires_at: string;
};

export async function POST(request: Request) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !telegramBotUsername) {
    return NextResponse.json({ error: "Telegram-вход пока не настроен." }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === "link" ? "link" : "signin";
  const admin = createAdminClient();
  let userId: string | null = null;

  if (mode === "link") {
    const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!accessToken) {
      return NextResponse.json({ error: "Сначала войди по e-mail, потом привяжи Telegram." }, { status: 401 });
    }

    const { data, error } = await admin.auth.getUser(accessToken);
    if (error || !data.user) {
      return NextResponse.json({ error: "Сессия устарела. Войди заново и попробуй еще раз." }, { status: 401 });
    }
    userId = data.user.id;
  }

  await admin.from("telegram_login_requests").delete().lt("expires_at", new Date().toISOString());

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await admin.from("telegram_login_requests").insert({
    token,
    mode,
    user_id: userId,
    expires_at: expiresAt,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    token,
    expiresAt,
    botUrl: `https://t.me/${telegramBotUsername}?start=${token}`,
  });
}

export async function GET(request: Request) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Telegram-вход пока не настроен." }, { status: 503 });
  }

  const token = new URL(request.url).searchParams.get("token") || "";
  if (!token) {
    return NextResponse.json({ error: "Не найден код входа." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("telegram_login_requests")
    .select("*")
    .eq("token", token)
    .maybeSingle<TelegramRequest>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ status: "error", error: "Ссылка устарела. Попробуй еще раз." }, { status: 404 });
  }

  if (new Date(data.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ status: "error", error: "Ссылка устарела. Попробуй еще раз." }, { status: 410 });
  }

  if (data.status === "pending") {
    return NextResponse.json({ status: "pending" });
  }

  if (data.status === "error") {
    return NextResponse.json({ status: "error", error: data.error || "Telegram не удалось подключить." }, { status: 400 });
  }

  if (!data.telegram_id) {
    return NextResponse.json({ status: "error", error: "Telegram не прислал профиль. Попробуй еще раз." }, { status: 400 });
  }

  if (data.mode === "link") {
    if (!data.user_id) {
      return NextResponse.json({ status: "error", error: "Сессия привязки потерялась. Попробуй еще раз." }, { status: 400 });
    }

    const { error: updateError } = await admin
      .from("profiles")
      .update({
        telegram_id: data.telegram_id,
        telegram_username: data.telegram_username,
        telegram_first_name: data.telegram_first_name,
        telegram_last_name: data.telegram_last_name,
        telegram_photo_url: data.telegram_photo_url,
        telegram_linked_at: new Date().toISOString(),
      })
      .eq("id", data.user_id);

    if (updateError) {
      return NextResponse.json({ status: "error", error: updateError.message }, { status: 500 });
    }

    await admin.from("telegram_login_requests").delete().eq("token", token);
    return NextResponse.json({ status: "linked" });
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("email")
    .eq("telegram_id", data.telegram_id)
    .maybeSingle<{ email: string | null }>();

  if (profileError) {
    return NextResponse.json({ status: "error", error: profileError.message }, { status: 500 });
  }

  if (!profile?.email) {
    return NextResponse.json(
      {
        status: "error",
        error: "Этот Telegram еще не привязан к аккаунту. Сначала войди по e-mail и привяжи Telegram в профиле.",
      },
      { status: 404 },
    );
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email,
    options: {
      redirectTo: process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin,
    },
  });

  const redirectUrl = linkData.properties?.action_link;
  if (linkError || !redirectUrl) {
    return NextResponse.json({ status: "error", error: linkError?.message || "Не удалось войти через Telegram." }, { status: 500 });
  }

  await admin.from("telegram_login_requests").delete().eq("token", token);
  return NextResponse.json({ status: "signed_in", redirectUrl });
}

function createAdminClient() {
  return createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
