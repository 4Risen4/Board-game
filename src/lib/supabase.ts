"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase variables are missing. Check .env.local or Vercel environment variables.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "owner" | "friend";
  telegram_id: string | null;
  telegram_username: string | null;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  telegram_photo_url: string | null;
  telegram_linked_at: string | null;
};

export type Review = {
  id: string;
  game_id: string;
  user_id: string;
  friend_name: string;
  fun: number;
  difficulty: number;
  comment: string | null;
  is_owner_review: boolean;
  created_at: string;
  profiles?: {
    display_name: string | null;
    email: string | null;
    role: "owner" | "friend";
  } | null;
};

export type ReviewProfile = NonNullable<Review["profiles"]>;

export type Game = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  created_at: string;
  reviews: Review[];
};
