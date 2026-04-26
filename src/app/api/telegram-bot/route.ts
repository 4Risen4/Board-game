import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";

type TelegramMessage = {
  message?: {
    text?: string;
    chat?: { id?: number };
    from?: {
      id?: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    };
  };
};

export async function POST(request: Request) {
  if (!supabaseUrl || !serviceRoleKey || !telegramBotToken) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const update = (await request.json().catch(() => ({}))) as TelegramMessage;
  const text = update.message?.text || "";
  const chatId = update.message?.chat?.id;
  const user = update.message?.from;
  const token = text.startsWith("/start ") ? text.replace("/start ", "").trim() : "";

  if (!chatId || !user?.id || !token) {
    return NextResponse.json({ ok: true });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: requestRow } = await admin
    .from("telegram_login_requests")
    .select("id,expires_at")
    .eq("token", token)
    .maybeSingle<{ id: string; expires_at: string }>();

  if (!requestRow || new Date(requestRow.expires_at).getTime() < Date.now()) {
    await sendTelegramMessage(chatId, "Эта ссылка уже устарела. Вернись на сайт и нажми Telegram-вход еще раз.");
    return NextResponse.json({ ok: true });
  }

  const { error } = await admin
    .from("telegram_login_requests")
    .update({
      status: "completed",
      telegram_id: String(user.id),
      telegram_username: user.username || null,
      telegram_first_name: user.first_name || null,
      telegram_last_name: user.last_name || null,
      telegram_photo_url: user.photo_url || null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", requestRow.id);

  if (error) {
    await sendTelegramMessage(chatId, "Не получилось подтвердить вход. Попробуй еще раз.");
    return NextResponse.json({ ok: true });
  }

  await sendTelegramMessage(
    chatId,
    `Готово, Telegram подтвержден. Вернись на сайт${siteUrl ? ` ${siteUrl}` : ""} — он сам продолжит вход.`,
  );

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}

async function sendTelegramMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => undefined);
}
