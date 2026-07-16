import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // .env.local (ローカル) / Vercelの環境変数 に設定し忘れている場合はここに出る
  console.error(
    "Supabaseの環境変数(VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)が設定されていません。"
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,   // ログイン状態を端末のブラウザに保持(次回から自動ログイン)
    autoRefreshToken: true,
  },
});