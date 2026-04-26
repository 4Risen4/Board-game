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

type ProfileLogin = {
  id: string;
  email: string | null;
};

type AdminClient = ReturnType<typeof createAdminClient>;

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
    const linkResult = await linkTelegramProfile(admin, data);
    if ("error" in linkResult) {
      return NextResponse.json({ status: "error", error: linkResult.error }, { status: 500 });
    }

    await admin.from("telegram_login_requests").delete().eq("token", token);
    return NextResponse.json({ status: "linked" });
  }

  const profileResult = await findOrCreateTelegramProfile(admin, data);
  if ("error" in profileResult) {
    return NextResponse.json({ status: "error", error: profileResult.error }, { status: 500 });
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: profileResult.profile.email,
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

async function linkTelegramProfile(admin: AdminClient, data: TelegramRequest) {
  if (!data.user_id) {
    return { error: "Сессия привязки потерялась. Попробуй еще раз." };
  }

  const { error } = await admin
    .from("profiles")
    .update(getTelegramProfileFields(data))
    .eq("id", data.user_id);

  if (error) {
    return { error: error.message };
  }

  return { ok: true };
}

async function findOrCreateTelegramProfile(admin: AdminClient, data: TelegramRequest) {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,email")
    .eq("telegram_id", data.telegram_id)
    .maybeSingle<ProfileLogin>();

  if (profileError) {
    return { error: profileError.message };
  }

  if (profile?.email) {
    return { profile: { id: profile.id, email: profile.email } };
  }

  return createTelegramProfile(admin, data);
}

async function createTelegramProfile(admin: AdminClient, data: TelegramRequest) {
  if (!data.telegram_id) {
    return { error: "Telegram не прислал профиль. Попробуй еще раз." };
  }

  const email = `telegram-${data.telegram_id}@telegram.board-game.local`;
  const displayName = getTelegramDisplayName(data);
  const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });

  if (createError && !createError.message.toLowerCase().includes("already")) {
    return { error: createError.message };
  }

  let userId = createdUser.user?.id || null;
  if (!userId) {
    const { data: existingProfile, error: existingError } = await admin
      .from("profiles")
      .select("id,email")
      .eq("email", email)
      .maybeSingle<ProfileLogin>();

    if (existingError || !existingProfile) {
      return { error: existingError?.message || "Не получилось создать Telegram-аккаунт." };
    }
    userId = existingProfile.id;
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    email,
    display_name: displayName,
    role: "friend",
    ...getTelegramProfileFields(data),
  });

  if (profileError) {
    return { error: profileError.message };
  }

  return { profile: { id: userId, email } };
}

function getTelegramProfileFields(data: TelegramRequest) {
  return {
    telegram_id: data.telegram_id,
    telegram_username: data.telegram_username,
    telegram_first_name: data.telegram_first_name,
    telegram_last_name: data.telegram_last_name,
    telegram_photo_url: data.telegram_photo_url,
    telegram_linked_at: new Date().toISOString(),
  };
}

function getTelegramDisplayName(data: TelegramRequest) {
  const fullName = [data.telegram_first_name, data.telegram_last_name].filter(Boolean).join(" ").trim();
  return fullName || data.telegram_username || `Telegram ${data.telegram_id}`;
}
