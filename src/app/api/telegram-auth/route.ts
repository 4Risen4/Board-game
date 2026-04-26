import { createHash, createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;

export async function POST(request: Request) {
  if (!telegramBotToken) {
    return NextResponse.json({ error: "Telegram bot token пока не настроен." }, { status: 503 });
  }

  const body = await request.json();
  const mode = body.mode === "link" ? "link" : "signin";
  const telegramUser = body.user as TelegramUser | undefined;

  if (!telegramUser || !isValidTelegramUser(telegramUser, telegramBotToken)) {
    return NextResponse.json({ error: "Telegram не прошел проверку. Попробуй еще раз." }, { status: 401 });
  }

  if (mode === "link") {
    return NextResponse.json({ telegramUser: publicTelegramUser(telegramUser) });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Для входа через Telegram нужен Supabase service role key." }, { status: 503 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("email")
    .eq("telegram_id", String(telegramUser.id))
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!profile?.email) {
    return NextResponse.json(
      { error: "Этот Telegram еще не привязан к аккаунту. Сначала войди по e-mail и привяжи Telegram в профиле." },
      { status: 404 },
    );
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email,
    options: {
      redirectTo: process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin,
    },
  });

  const redirectUrl = data.properties?.action_link;
  if (error || !redirectUrl) {
    return NextResponse.json({ error: error?.message || "Не удалось создать вход через Telegram." }, { status: 500 });
  }

  return NextResponse.json({ redirectUrl });
}

function isValidTelegramUser(user: TelegramUser, botToken: string) {
  if (!user.hash || !user.auth_date || !user.id) return false;
  const ageInSeconds = Math.floor(Date.now() / 1000) - Number(user.auth_date);
  if (ageInSeconds > 60 * 60 * 24) return false;

  const entries = Object.entries(user)
    .filter(([key, value]) => key !== "hash" && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .sort();

  const checkString = entries.join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const digest = createHmac("sha256", secret).update(checkString).digest("hex");

  const expected = Buffer.from(digest, "hex");
  const received = Buffer.from(user.hash, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function publicTelegramUser(user: TelegramUser) {
  return {
    id: user.id,
    first_name: user.first_name || null,
    last_name: user.last_name || null,
    username: user.username || null,
    photo_url: user.photo_url || null,
  };
}
