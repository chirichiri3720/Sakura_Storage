import { supabase } from "./supabaseClient.js";

/* window.storage / IndexedDB と同じ get/set/delete インターフェースのまま、
   実体は Supabase の kv_store テーブル(1行 = user_id + key + value)。
   同じアカウントでログインすればスマホ・PCどちらからでも同じデータが見える。 */
export const storage = {
  async get(key) {
    const { data, error } = await supabase
      .from("kv_store")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return data ? { key, value: data.value } : null;
  },
  async set(key, value) {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth && auth.user;
    if (!user) throw new Error("not signed in");
    const { error } = await supabase
      .from("kv_store")
      .upsert(
        { user_id: user.id, key, value, updated_at: new Date().toISOString() },
        { onConflict: "user_id,key" }
      );
    if (error) throw error;
    return { key, value };
  },
  async delete(key) {
    const { error } = await supabase.from("kv_store").delete().eq("key", key);
    if (error) throw error;
    return { key, deleted: true };
  },
};
