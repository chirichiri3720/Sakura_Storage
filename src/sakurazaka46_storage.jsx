import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import photosData from "./photos_data.json";
import { supabase } from "./lib/supabaseClient.js";
import { storage } from "./lib/storage.js";

/* ═══════════════════════════════════════════════
   櫻坂46storage — 生写真管理 v4
   - ストレージ(閲覧専用) / 編集(下書き→確定) / 検索(MV絞込) / 希望 / お気に入り / 集計(週次グラフ)
   - カット×バリアント(衣装違い)対応
   - 保存: Supabase(kv_store) — 共有アカウントでログインした端末間で同期
═══════════════════════════════════════════════ */

const ALL_CUTS = ["ヨリ", "チュウ", "ヒキ", "座り"];
const CUTS3 = ["ヨリ", "チュウ", "ヒキ"];
const KEY = "sakura_pocket_v4";
const GEN_LABEL = { 1: "一期生", 2: "二期生", 3: "三期生", 4: "四期生", 5: "五期生" };
const PRIORITY_LABEL = { 1: "高", 2: "中", 3: "低" };

/* [名前, 期, 現役|卒業生, ...在籍グループ("欅坂","櫻坂")] */
const MEMBER_SEED = [
  ["石森虹花", 1, "卒業生", "欅坂"], ["今泉佑唯", 1, "卒業生", "欅坂"], ["上村莉菜", 1, "卒業生", "欅坂", "櫻坂"],
  ["尾関梨香", 1, "卒業生", "欅坂", "櫻坂"], ["織田奈那", 1, "卒業生", "欅坂"], ["小池美波", 1, "卒業生", "欅坂", "櫻坂"],
  ["小林由依", 1, "卒業生", "欅坂", "櫻坂"], ["齋藤冬優花", 1, "卒業生", "欅坂", "櫻坂"], ["佐藤詩織", 1, "卒業生", "欅坂"],
  ["志田愛佳", 1, "卒業生", "欅坂"], ["菅井友香", 1, "卒業生", "欅坂", "櫻坂"], ["鈴本美愉", 1, "卒業生", "欅坂"],
  ["長沢菜々香", 1, "卒業生", "欅坂"], ["長濱ねる", 1, "卒業生", "欅坂"], ["土生瑞穂", 1, "卒業生", "欅坂", "櫻坂"],
  ["原田葵", 1, "卒業生", "欅坂", "櫻坂"], ["平手友梨奈", 1, "卒業生", "欅坂"],
  ["米谷奈々未", 1, "卒業生", "欅坂"], ["守屋茜", 1, "卒業生", "欅坂", "櫻坂"], ["渡辺梨加", 1, "卒業生", "欅坂", "櫻坂"],
  ["渡邉理佐", 1, "卒業生", "欅坂", "櫻坂"],
  ["井上梨名", 2, "卒業生", "欅坂", "櫻坂"], ["遠藤光莉", 2, "現役", "欅坂", "櫻坂"], ["大園玲", 2, "現役", "欅坂", "櫻坂"],
  ["大沼晶保", 2, "現役", "欅坂", "櫻坂"], ["幸阪茉里乃", 2, "現役", "欅坂", "櫻坂"], ["関有美子", 2, "卒業生", "欅坂", "櫻坂"],
  ["武元唯衣", 2, "卒業生", "欅坂", "櫻坂"], ["田村保乃", 2, "現役", "欅坂", "櫻坂"], ["藤吉夏鈴", 2, "現役", "欅坂", "櫻坂"],
  ["増本綺良", 2, "現役", "欅坂", "櫻坂"], ["松田里奈", 2, "現役", "欅坂", "櫻坂"], ["松平璃子", 2, "卒業生", "欅坂", "櫻坂"],
  ["森田ひかる", 2, "現役", "欅坂", "櫻坂"], ["守屋麗奈", 2, "現役", "欅坂", "櫻坂"], ["山﨑天", 2, "現役", "欅坂", "櫻坂"],
  ["石森璃花", 3, "現役", "櫻坂"], ["遠藤理子", 3, "現役", "櫻坂"], ["小田倉麗奈", 3, "現役", "櫻坂"],
  ["小島凪紗", 3, "現役", "櫻坂"], ["谷口愛季", 3, "現役", "櫻坂"], ["中嶋優月", 3, "現役", "櫻坂"],
  ["的野美青", 3, "現役", "櫻坂"], ["向井純葉", 3, "現役", "櫻坂"], ["村井優", 3, "現役", "櫻坂"],
  ["村山美羽", 3, "現役", "櫻坂"], ["山下瞳月", 3, "現役", "櫻坂"],
  ["浅井恋乃未", 4, "現役", "櫻坂"], ["稲熊ひな", 4, "現役", "櫻坂"], ["勝又春", 4, "現役", "櫻坂"],
  ["佐藤愛桜", 4, "現役", "櫻坂"], ["中川智尋", 4, "現役", "櫻坂"], ["松本和子", 4, "現役", "櫻坂"],
  ["目黒陽色", 4, "現役", "櫻坂"], ["山川宇衣", 4, "現役", "櫻坂"], ["山田桃実", 4, "現役", "櫻坂"],
];

const DEFAULT_MEMBERS = MEMBER_SEED.map(([name, gen, status, ...groups], i) => ({
  id: "m" + i, name, gen, status, groups, fav: false,
}));

/* 表示順: 現役 → 卒業生(櫻坂経験あり) → 欅坂のみ */
const memberTier = (m) => {
  if (m.status === "現役") return 0;
  return (m.groups || []).includes("櫻坂") ? 1 : 2;
};
const sortMembers = (arr) => [...arr].sort((a, b) => memberTier(a) - memberTier(b));

/* ---- 表記ゆれ吸収: photos_data.json 側の名前 → アプリ内メンバー名 ---- */
const NAME_ALIASES = { "渡邊理佐": "渡邉理佐" };

/* 名前 → 期(gen) 逆引き(カタログの「〇期生」ラベル自動判定に使用) */
const NAME_TO_GEN = new Map(MEMBER_SEED.map(([name, gen]) => [name, gen]));

/* 品目名で「選抜」「BACKS」ラベルを付与する対象(手動リスト) */
const SELECT_ITEM_NAMES = new Set([
  "「Nobody's fault」MVロケーション制服衣装", "「BAN」MVロケーション制服衣装", "「BAN」歌番組衣装",
  "「流れ弾」MVロケーション衣装", "「流れ弾」MV黒衣装", "「五月雨よ」MVパフォーマンス衣装",
  "「摩擦係数」MV衣装", "「桜月」MV衣装", "「桜月」MV青衣装",
  "「Start over!」MV衣装", "「Start over!」歌唱衣装", "「承認欲求」MV衣装",
  "「何歳の頃に戻りたいのか？」MV衣装", "「自業自得」MV衣装", "「I want tomorrow to come」MV衣装",
  "「UDAGAWA GENERATION」MV衣装", "「Make or Break」MV衣装", "「Unhappy birthday構文」MV衣装",
  "「The growing up train」MV衣装", "「Lonesome rabbit」MV衣装", "「The growing up train」歌唱衣装",
]);
const BACKS_ITEM_NAMES = new Set([
  "「BACKS LIVE!!」メインビジュアル用MV衣装", "「BACKS LIVE!!」メインビジュアル用私服衣装",
  "3rd Single「BACKS LIVE!!」ビジュアルMV衣装", "「3rd Single BACKS LIVE!!」衣装",
  "「7th Single BACKS LIVE!!」オープニング衣装", "「油を注せ!」MV衣装", "Tシャツコーデ",
  "「8th Single BACKS LIVE!!」ライブ衣装", "「愛し合いなさい」MVカラフル衣装", "「愛し合いなさい」MV黒衣装",
  "「僕は僕を好きになれない」MV衣装", "「9th Single BACKS LIVE!!」オープニング衣装", "「Nothing special」MV衣装",
  "「港区パセリ」MV衣装", "「11th Single BACKS LIVE!!」ライブ衣装", "「10th Single BACKS LIVE!!」ライブ衣装",
  "「12th Single BACKS LIVE!!」衣装", "「木枯らしは泣かない」MV衣装", "「12th Single BACKS LIVE!!」黒衣装",
  "「ドライフルーツ」MV衣装", "「13th Single BACKS LIVE!!」黒衣装", "「13th Single BACKS LIVE!!」緑衣装",
  "「コインランドリー」MV衣装",
]);

/* カット数 → カット構成の割り当て */
function cutsForCount(n) {
  if (n === 4) return ALL_CUTS;
  if (n === 3) return CUTS3;
  if (n === 1) return ["単品"];
  if (n === 2) return ["ヨリ", "チュウ"];
  return Array.from({ length: n }, (_, i) => `${i + 1}枚目`);
}

/* ---- 公式ランダム生写真 発売カタログ(photos_data.jsonから生成)
   variant違い(例: 眼鏡有/無)は members 配列に順序維持のまま保持する ---- */
const PHOTO_CATALOG = photosData.map((item) => {
  const seen = new Set();
  const members = [];
  (item.メンバー || []).forEach((mm) => {
    const name = NAME_ALIASES[mm.name] || mm.name;
    const variant = mm.variant || "";
    const dk = name + "|" + variant;
    if (seen.has(dk)) return;
    seen.add(dk);
    members.push({ name, variant });
  });

  const labels = [];
  if (SELECT_ITEM_NAMES.has(item.品目)) labels.push("選抜");
  if (BACKS_ITEM_NAMES.has(item.品目)) labels.push("BACKS");
  const gens = members.map((mm) => NAME_TO_GEN.get(mm.name));
  if (gens.length > 0 && gens.every((g) => g !== undefined && g === gens[0])) {
    labels.push(GEN_LABEL[gens[0]] || `${gens[0]}期生`);
  }

  return {
    date: item.発売日,
    name: item.品目,
    members,
    memberCount: item.メンバー数,
    autograph: !!item.直筆,
    cutCount: item.カット,
    cuts: cutsForCount(item.カット),
    isMV: /MV/.test(item.品目 || ""),
    labels,
  };
});

const DEFAULT_STATE = {
  members: DEFAULT_MEMBERS,
  series: [],     // {id,name,era,timing,targetIds,cuts,memberVariants?}
  holdings: {},   // "s|m|c|v" -> {n,d,h}
  meta: {},       // "s|m|c|v" -> {w,loc,note,priority}
  history: {},    // "YYYY-MM-DD" -> 総所持枚数
  ver: 4,
};

const hkey = (s, m, c, v = "") => `${s}|${m}|${c}|${v}`;
const imgKey = (k) => "spimg_" + k;
const todayISO = () => new Date().toISOString().slice(0, 10);

/* メンバーのシリーズ内バリアント一覧(無ければ[""]の1行) */
function memberRows(sr, mId) {
  const list = sr.memberVariants && sr.memberVariants[mId];
  return list && list.length ? list : [""];
}

/* 増減/難あり/高めの純粋トグル関数(下書き・確定共通) */
function bumpHolding(cur, mode) {
  let { n = 0, d = 0, h = 0 } = cur || {};
  if (mode === "add") n += 1;
  else if (mode === "sub") { n = Math.max(0, n - 1); d = Math.min(d, n); h = Math.min(h, n); }
  else if (mode === "dmg") { if (n > 0) d = d < n ? d + 1 : 0; }
  else if (mode === "high") { if (n > 0) h = h < n ? h + 1 : 0; }
  return { n, d, h };
}

function patchMeta(cur, patch) {
  const next = { ...(cur || {}), ...patch };
  if (!next.w && !next.loc && !next.note && !next.priority) return undefined;
  return next;
}

function nextPriority(p) {
  if (p === 1) return 2;
  if (p === 2) return 3;
  if (p === 3) return undefined;
  return 1;
}

function seriesStats(sr, get) {
  const cuts = sr.cuts || ALL_CUTS;
  let total = 0, owned = 0, dub = 0, comp = 0;
  sr.targetIds.forEach((mId) => {
    memberRows(sr, mId).forEach((v) => {
      total += cuts.length;
      let oc = 0;
      cuts.forEach((c) => {
        const { n } = get(sr.id, mId, c, v);
        if (n >= 1) { owned++; oc++; }
        if (n >= 2) dub += n - 1;
      });
      if (compStatus(oc, cuts.length) === "comp") comp++;
    });
  });
  return { total, owned, dub, comp, pct: total ? Math.round((owned / total) * 100) : 0 };
}

function seriesTotalHeld(sr, get) {
  const cuts = sr.cuts || ALL_CUTS;
  let total = 0;
  sr.targetIds.forEach((mId) => memberRows(sr, mId).forEach((v) => cuts.forEach((c) => { total += get(sr.id, mId, c, v).n; })));
  return total;
}

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // 月曜=0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/* 保存データにグループタグを同期(タグ変更の反映) */
function migrateMembers(members) {
  const seedByName = new Map(MEMBER_SEED.map(([name, gen, status, ...groups]) => [name, { gen, status, groups }]));
  return members
    .filter((m) => m.name !== "原田まゆ")
    .map((m) => {
      const seed = seedByName.get(m.name);
      const base = seed ? { ...m, status: seed.status, groups: seed.groups }
        : (!m.groups ? { ...m, groups: m.gen >= 3 ? ["櫻坂"] : ["欅坂", "櫻坂"] } : m);
      return { ...base, fav: !!base.fav };
    });
}

async function loadState() {
  try {
    const r = await storage.get(KEY);
    if (r && r.value) {
      const p = JSON.parse(r.value);
      if (p && p.members && p.ver === 4) return { ...p, members: migrateMembers(p.members) };
    }
  } catch (e) { /* noop */ }
  return null;
}

/* コンプ状態: comp / semi / partial / none */
function compStatus(ownedCuts, totalCuts) {
  if (totalCuts === 0) return "none";
  if (ownedCuts === totalCuts) return "comp";
  if (ownedCuts === totalCuts - 1 && ownedCuts > 0) return "semi";
  if (ownedCuts > 0) return "partial";
  return "none";
}

/* ═══════════ ログイン画面 ═══════════ */
function LoginGate() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr("メールアドレスまたはパスワードが違います");
  };

  return (
    <div style={{ ...S.app, display: "grid", placeItems: "center", minHeight: "60vh" }}>
      <FontLoad />
      <form onSubmit={submit} style={{ ...S.formCard, maxWidth: 320, width: "90%" }}>
        <div style={{ ...S.logoRow, justifyContent: "center", marginBottom: 14 }}>
          <Petal size={22} />
          <span style={S.logoText}>櫻坂46<span style={{ color: "#3A2A33" }}>storage</span></span>
        </div>
        <label style={S.formLabel}>メールアドレス</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ ...S.input, width: "100%" }} required autoFocus />
        <label style={{ ...S.formLabel, marginTop: 10 }}>パスワード</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          style={{ ...S.input, width: "100%" }} required />
        {err && <div style={{ color: "#C64B7C", fontSize: 12, marginTop: 8 }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ ...S.primaryBtn, width: "100%", marginTop: 14 }}>
          {busy ? "確認中…" : "ログイン"}
        </button>
      </form>
    </div>
  );
}

/* ═══════════════ 認証ゲート ═══════════════ */
export default function SakurazakaStorage() {
  const [session, setSession] = useState(undefined); // undefined=確認中 / null=未ログイン / object=ログイン済

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div style={{ ...S.app, display: "grid", placeItems: "center", minHeight: "60vh" }}>
        <FontLoad /><div style={{ color: "#C64B7C", fontWeight: 700 }}>読み込み中…</div>
      </div>
    );
  }
  if (!session) return <LoginGate />;
  return <AppInner onSignOut={() => supabase.auth.signOut()} />;
}

/* ═══════════════ App本体 ═══════════════ */
function AppInner({ onSignOut }) {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("storage"); // storage|edit|search|wish|stats
  const [toast, setToast] = useState("");
  const [shot, setShot] = useState(null);
  const saveTimer = useRef(null);

  useEffect(() => { (async () => setState((await loadState()) || DEFAULT_STATE))(); }, []);

  useEffect(() => {
    if (!state) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await storage.set(KEY, JSON.stringify(state)); }
      catch (e) { console.error(e); }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [state]);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 1800); };
  const update = useCallback((fn) => setState((s) => fn(structuredClone(s))), []);

  if (!state) return (
    <div style={{ ...S.app, display: "grid", placeItems: "center", minHeight: "60vh" }}>
      <FontLoad /><div style={{ color: "#C64B7C", fontWeight: 700 }}>読み込み中…</div>
    </div>
  );

  const memberById = (id) => state.members.find((m) => m.id === id);
  const seriesFor = (mId) => state.series.filter((sr) => sr.targetIds.includes(mId));
  const get = (s, m, c, v = "") => state.holdings[hkey(s, m, c, v)] || { n: 0, d: 0, h: 0 };
  const getMeta = (s, m, c, v = "") => state.meta[hkey(s, m, c, v)] || {};

  /* メンバー集計(コンプ/セミ含む・バリアント対応) */
  const memberStats = (mId) => {
    const srs = seriesFor(mId);
    let total = 0, owned = 0, dub = 0, dmg = 0, high = 0, comp = 0, semi = 0;
    srs.forEach((sr) => {
      const cuts = sr.cuts || ALL_CUTS;
      memberRows(sr, mId).forEach((v) => {
        total += cuts.length;
        let oc = 0;
        cuts.forEach((c) => {
          const { n, d, h } = get(sr.id, mId, c, v);
          if (n >= 1) { owned++; oc++; }
          if (n >= 2) dub += n - 1;
          dmg += d; high += h;
        });
        const cs = compStatus(oc, cuts.length);
        if (cs === "comp") comp++; else if (cs === "semi") semi++;
      });
    });
    return { total, owned, dub, dmg, high, comp, semi, nSeries: srs.length, pct: total ? Math.round((owned / total) * 100) : 0 };
  };

  const toggleFavorite = (mId) => update((st) => {
    const m = st.members.find((x) => x.id === mId); m.fav = !m.fav; return st;
  });

  const addSeries = (sr) => { update((st) => { st.series.unshift(sr); return st; }); showToast("シリーズを追加しました"); };

  const addMembersToSeries = (sId, newIds) => {
    update((st) => {
      const sr = st.series.find((s) => s.id === sId);
      if (sr) sr.targetIds = [...new Set([...sr.targetIds, ...newIds])];
      return st;
    });
    showToast("メンバーを追加しました");
  };

  const deleteSeries = (sId) => {
    if (!confirm("このシリーズと記録を削除しますか？")) return;
    update((st) => {
      st.series = st.series.filter((x) => x.id !== sId);
      [st.holdings, st.meta].forEach((obj) =>
        Object.keys(obj).forEach((k) => { if (k.startsWith(sId + "|")) delete obj[k]; }));
      return st;
    });
  };

  /* 編集タブの「確定」: 下書きの holdings/meta をまとめて反映し、週次履歴を記録 */
  const commitDraft = (patchHoldings, patchMeta) => {
    update((st) => {
      Object.entries(patchHoldings || {}).forEach(([k, v]) => {
        if (!v || v.n === 0) delete st.holdings[k]; else st.holdings[k] = v;
      });
      Object.entries(patchMeta || {}).forEach(([k, v]) => {
        if (!v) delete st.meta[k]; else st.meta[k] = v;
      });
      const total = Object.values(st.holdings).reduce((a, x) => a + x.n, 0);
      st.history[todayISO()] = total;
      return st;
    });
  };

  /* 希望タブ用の即時メタ更新(優先度・メモ・削除) */
  const setWishMeta = (sId, mId, cut, variant, patch) => update((st) => {
    const k = hkey(sId, mId, cut, variant);
    const next = patchMeta(st.meta[k], patch);
    if (!next) delete st.meta[k]; else st.meta[k] = next;
    return st;
  });

  const wishItems = () => {
    const out = [];
    Object.entries(state.meta).forEach(([k, meta]) => {
      if (!meta || !meta.w) return;
      const [sId, mId, c, v] = k.split("|");
      const sr = state.series.find((s) => s.id === sId); if (!sr) return;
      const m = memberById(mId); if (!m) return;
      const { n } = get(sId, mId, c, v);
      if (n > 0) return;
      out.push({ sr, m, c, v, priority: meta.priority, note: meta.note || "" });
    });
    out.sort((a, b) => (a.priority || 9) - (b.priority || 9));
    return out;
  };

  /* スクショ用表示(読み取り専用) */
  if (shot) {
    const m = memberById(shot);
    const srs = seriesFor(shot);
    return (
      <div style={S.shotBg} onClick={() => setShot(null)}>
        <FontLoad />
        <div style={S.shotCard}>
          <div style={S.shotHead}>
            <Petal size={20} />
            <span style={{ fontWeight: 900, fontSize: 17, color: "#C64B7C" }}>{m.name}</span>
            <span style={S.badgeGen}>{GEN_LABEL[m.gen]}</span>
            <span style={m.status === "現役" ? S.badgeActive : S.badgeGrad}>{m.status}</span>
          </div>
          <MemberCutTable m={m} seriesList={srs} get={get} readOnly onTap={undefined} />
          <div style={S.shotFoot}>櫻坂46storage</div>
        </div>
        <div style={S.shotHint}>この画面をスクリーンショット → タップで戻る</div>
      </div>
    );
  }

  return (
    <div style={S.app}>
      <FontLoad />
      <header style={S.header}>
        <div style={S.logoRow}>
          <Petal size={22} />
          <span style={S.logoText}>櫻坂46<span style={{ color: "#3A2A33" }}>storage</span></span>
          <button onClick={onSignOut} style={S.logoutBtn} title="ログアウト">⏻</button>
        </div>
        <span style={S.logoSub}>生写真コレクション管理（欅坂46対応）</span>
      </header>

      <main style={S.main}>
        {tab === "storage" && (
          <StorageTab allMembers={state.members} allSeries={state.series} get={get}
            memberById={memberById} seriesFor={seriesFor} memberStats={memberStats}
            onToggleFav={toggleFavorite} onShotOpen={setShot} />
        )}
        {tab === "edit" && (
          <EditTab allMembers={state.members} allSeries={state.series} get={get} getMeta={getMeta}
            memberById={memberById} seriesFor={seriesFor} memberStats={memberStats}
            commitDraft={commitDraft} addSeries={addSeries} addMembersToSeries={addMembersToSeries}
            deleteSeries={deleteSeries} showToast={showToast} />
        )}
        {tab === "search" && <SearchTab state={state} get={get} getMeta={getMeta} />}
        {tab === "wish" && <WishTab items={wishItems()} setWishMeta={setWishMeta} />}
        {tab === "stats" && <StatsTab state={state} statsOf={memberStats} get={get} />}
      </main>

      <nav style={S.tabbar}>
        {[["storage", "ストレージ", "📦"], ["edit", "編集", "✎"], ["search", "検索", "⌕"],
          ["wish", "希望", "♡"], ["stats", "集計", "◔"]].map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ ...S.tabBtn, ...(tab === id ? S.tabBtnOn : {}) }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span><span>{label}</span>
          </button>
        ))}
      </nav>

      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}

/* ═══════════ セル ═══════════ */
function Cell({ v, onClick, readOnly }) {
  const { n, d, h } = v;
  const st = n === 0 ? S.cellZero : n === 1 ? S.cellOne : S.cellDub;
  return (
    <button onClick={readOnly ? undefined : onClick}
      style={{ ...S.cell, ...st, position: "relative", cursor: readOnly ? "default" : "pointer" }}>
      {n === 0 ? "" : n === 1 ? "1" : `×${n}`}
      {d > 0 && <span style={S.dmgBadge}>⚠{d > 1 ? d : ""}</span>}
      {h > 0 && <span style={S.highBadge}>💎{h > 1 ? h : ""}</span>}
    </button>
  );
}

function CompChip({ status }) {
  if (status === "comp") return <span style={S.compChip}>コンプ</span>;
  if (status === "semi") return <span style={S.semiChip}>セミコンプ</span>;
  return null;
}

function Legend() {
  return (
    <div style={S.legend}>
      <span><i style={{ ...S.dot, background: "#fff", border: "1.5px dashed #DDB9C8" }} /> 未所持</span>
      <span><i style={{ ...S.dot, background: "#F7CBDC" }} /> 所持</span>
      <span><i style={{ ...S.dot, background: "#C64B7C" }} /> 複数所持</span>
      <span>⚠ 難あり</span>
      <span>💎 高め</span>
    </div>
  );
}

function ModeSwitch({ mode, setMode }) {
  return (
    <div style={S.segment}>
      {[["add", "＋追加"], ["sub", "−減"], ["dmg", "⚠難"], ["high", "💎高"]].map(([v, l]) => (
        <button key={v} onClick={() => setMode(v)} style={{ ...S.segBtn, ...(mode === v ? S.segBtnOn : {}) }}>{l}</button>
      ))}
    </div>
  );
}

function Ring({ pct, small }) {
  const sz = small ? 38 : 46, r = small ? 14 : 17, c = 2 * Math.PI * r, mid = sz / 2;
  return (
    <svg width={sz} height={sz} viewBox={`0 0 ${sz} ${sz}`} style={{ flexShrink: 0 }}>
      <circle cx={mid} cy={mid} r={r} fill="none" stroke="#F3DCE6" strokeWidth="4.5" />
      <circle cx={mid} cy={mid} r={r} fill="none" stroke="#C64B7C" strokeWidth="4.5"
        strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="round"
        transform={`rotate(-90 ${mid} ${mid})`} />
      <text x={mid} y={mid + 3.5} textAnchor="middle" fontSize={small ? 9.5 : 11} fontWeight="700" fill="#8A5A6E">{pct}%</text>
    </svg>
  );
}

function Petal({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 2C9 6 5 8 5 13a7 7 0 0 0 14 0c0-5-4-7-7-11z" fill="#E56C97" />
      <path d="M12 6c-1.5 2.5-3.5 4-3.5 7a3.5 3.5 0 0 0 7 0c0-3-2-4.5-3.5-7z" fill="#FBE4EC" />
    </svg>
  );
}

function FontLoad() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700;900&display=swap');
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      button { font-family: inherit; cursor: pointer; }
      input, select, textarea { font-family: inherit; }
    `}</style>
  );
}

/* ═══════════ メンバー軸のカット表(シリーズ横断・読み取り/編集共通) ═══════════ */
function MemberCutTable({ m, seriesList, get, readOnly, onTap }) {
  return (
    <>
      <Legend />
      <div style={S.gridHead}>
        <div style={{ fontWeight: 700 }}>シリーズ</div>
        {ALL_CUTS.map((c) => <div key={c} style={S.cutHead}>{c}</div>)}
      </div>
      {seriesList.length === 0 && <div style={S.empty}>対象シリーズがありません。</div>}
      {seriesList.map((sr) => {
        const cuts = sr.cuts || ALL_CUTS;
        return memberRows(sr, m.id).map((v, vi) => {
          const oc = cuts.filter((c) => get(sr.id, m.id, c, v).n >= 1).length;
          return (
            <div key={sr.id + "|" + v} style={S.gridRow}>
              <div style={{ ...S.nameCol, fontSize: 12 }}>
                {sr.name}{v && <span style={{ color: "#C7A5B4" }}> ({v})</span>} <CompChip status={compStatus(oc, cuts.length)} />
                {vi === 0 && <div style={{ fontSize: 10, color: "#B99AA8" }}>{sr.era}{sr.timing ? "・" + sr.timing : ""}</div>}
              </div>
              {ALL_CUTS.map((c) => cuts.includes(c)
                ? <Cell key={c} v={get(sr.id, m.id, c, v)} readOnly={readOnly} onClick={readOnly ? undefined : () => onTap(sr.id, m.id, c, v)} />
                : <div key={c} style={S.cellNone}>—</div>)}
            </div>
          );
        });
      })}
    </>
  );
}

/* ═══════════ シリーズ軸のカット表(メンバー横断・読み取り/編集共通) ═══════════ */
function SeriesCutTable({ sr, targets, get, readOnly, onTap, favIds }) {
  const cuts = sr.cuts || ALL_CUTS;
  const gridCols = { gridTemplateColumns: `1fr ${cuts.map(() => "46px").join(" ")}` };
  return (
    <>
      <Legend />
      <div style={{ ...S.gridHead, ...gridCols }}>
        <div style={{ fontWeight: 700 }}>メンバー</div>
        {cuts.map((c) => <div key={c} style={S.cutHead}>{c}</div>)}
      </div>
      {targets.map((m) => memberRows(sr, m.id).map((v) => {
        const oc = cuts.filter((c) => get(sr.id, m.id, c, v).n >= 1).length;
        return (
          <div key={m.id + "|" + v} style={{ ...S.gridRow, ...gridCols }}>
            <div style={S.nameCol}>
              {favIds && favIds.has(m.id) && <span style={{ color: "#C64B7C", marginRight: 3 }}>★</span>}
              {m.name}{v && <span style={{ color: "#C7A5B4" }}> ({v})</span>} <CompChip status={compStatus(oc, cuts.length)} />
            </div>
            {cuts.map((c) => (
              <Cell key={c} v={get(sr.id, m.id, c, v)} readOnly={readOnly} onClick={readOnly ? undefined : () => onTap(sr.id, m.id, c, v)} />
            ))}
          </div>
        );
      }))}
    </>
  );
}

/* ═══════════ ストレージタブ(閲覧専用) ═══════════ */
function StorageTab({ allMembers, allSeries, get, memberById, seriesFor, memberStats, onToggleFav, onShotOpen }) {
  const [view, setView] = useState("members");
  const [memberDetail, setMemberDetail] = useState(null);
  const [seriesDetail, setSeriesDetail] = useState(null);
  const [zoom, setZoom] = useState(false);
  const [f, setF] = useState("現役");
  const [q, setQ] = useState("");
  const [sortMode, setSortMode] = useState("fav"); // fav=お気に入り優先(デフォルト) / order=メンバー順

  const ownedMembers = sortMembers(allMembers.filter((m) => {
    if (memberStats(m.id).owned <= 0) return false;
    if (q && !m.name.includes(q)) return false;
    if (f === "全員") return true;
    if (f === "現役" || f === "卒業生") return m.status === f;
    if (f === "櫻坂" || f === "欅坂") return (m.groups || []).includes(f);
    return m.gen === Number(f);
  }));
  if (sortMode === "fav") {
    ownedMembers.sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0));
  }
  const ownedSeries = allSeries.filter((sr) => seriesTotalHeld(sr, get) > 0);

  if (view === "members" && memberDetail) {
    const m = memberById(memberDetail);
    const srs = seriesFor(memberDetail);
    const st = memberStats(memberDetail);
    return (
      <div>
        <div style={S.gridTop}>
          <button style={S.backBtn} onClick={() => setMemberDetail(null)}>‹ 一覧</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 900, fontSize: 16 }}>{m.name}</span>
              <span style={S.badgeGen}>{GEN_LABEL[m.gen]}</span>
              <span style={m.status === "現役" ? S.badgeActive : S.badgeGrad}>{m.status}</span>
            </div>
            <div style={S.seriesMeta}>
              {st.owned}/{st.total}（{st.pct}%）
              {st.comp > 0 && <span style={S.compChip}>コンプ{st.comp}</span>}
              {st.semi > 0 && <span style={S.semiChip}>セミ{st.semi}</span>}
            </div>
          </div>
          <button style={S.shotBtn} onClick={() => onShotOpen(memberDetail)}>📷</button>
        </div>
        <MemberCutTable m={m} seriesList={srs} get={get} readOnly onTap={undefined} />
      </div>
    );
  }

  if (view === "series" && seriesDetail) {
    const sr = allSeries.find((s) => s.id === seriesDetail);
    const targets = sortMembers(sr.targetIds.map((id) => memberById(id)).filter(Boolean));
    return (
      <div>
        <div style={S.gridTop}>
          <button style={S.backBtn} onClick={() => { setSeriesDetail(null); setZoom(false); }}>‹ 一覧</button>
          <div style={{ ...S.seriesName, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{sr.name}</div>
        </div>
        <button style={S.zoomTrigger} onClick={() => setZoom(true)}>
          <SamplePhotoImg name={sr.name} style={S.catPreviewImg} />
        </button>
        {zoom && (
          <div style={S.zoomOverlay} onClick={() => setZoom(false)}>
            <SamplePhotoImg name={sr.name} style={S.zoomImg} />
          </div>
        )}
        <div style={S.seriesMeta}>
          <span style={sr.era === "欅坂46" ? S.badgeKeyaki : S.badgeSakura}>{sr.era}</span>
          {sr.timing && <span>{sr.timing}</span>}
          <span>{targets.length}名×{(sr.cuts || ALL_CUTS).length}カット</span>
        </div>
        <SeriesCutTable sr={sr} targets={targets} get={get} readOnly onTap={undefined} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ ...S.segment, maxWidth: 220, marginBottom: 12 }}>
        {[["members", "メンバー"], ["series", "シリーズ"]].map(([v, l]) => (
          <button key={v} onClick={() => setView(v)} style={{ ...S.segBtn, ...(view === v ? S.segBtnOn : {}) }}>{l}</button>
        ))}
      </div>
      {view === "members" ? (
        <div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前で検索"
            style={{ ...S.input, width: "100%", marginBottom: 10 }} />
          <div style={{ ...S.chipRow, marginBottom: 8 }}>
            {[["全員", "全員"], ["現役", "現役"], ["卒業生", "卒業生"], ["櫻坂", "櫻坂"], ["欅坂", "欅坂"],
              ["1", "一期"], ["2", "二期"], ["3", "三期"], ["4", "四期"]].map(([v, l]) => (
              <button key={v} onClick={() => setF(v)} style={{ ...S.chip, ...(f === v ? S.chipOn : {}) }}>{l}</button>
            ))}
          </div>
          <div style={{ ...S.segment, maxWidth: 260, marginBottom: 12 }}>
            {[["fav", "お気に入り優先"], ["order", "メンバー順"]].map(([v, l]) => (
              <button key={v} onClick={() => setSortMode(v)} style={{ ...S.segBtn, ...(sortMode === v ? S.segBtnOn : {}) }}>{l}</button>
            ))}
          </div>
          {ownedMembers.length === 0 && <div style={S.empty}>まだ所持データがありません。編集タブで枚数を登録してください。</div>}
          {ownedMembers.map((m) => {
            const st = memberStats(m.id);
            return (
              <div key={m.id} style={S.memberCard}>
                <button onClick={() => onToggleFav(m.id)} aria-label="お気に入り"
                  style={{ ...S.starBtn, color: m.fav ? "#C64B7C" : "#DCC3CF" }}>★</button>
                <button style={S.memberMain} onClick={() => setMemberDetail(m.id)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{m.name}</span>
                    <span style={S.badgeGen}>{GEN_LABEL[m.gen]}</span>
                    <span style={m.status === "現役" ? S.badgeActive : S.badgeGrad}>{m.status}</span>
                  </div>
                  <div style={S.seriesMeta}>
                    {st.owned}/{st.total} 所持
                    {st.comp > 0 && <span style={S.compChip}>コンプ{st.comp}</span>}
                    {st.semi > 0 && <span style={S.semiChip}>セミ{st.semi}</span>}
                    {st.dub > 0 && <span style={S.dubTag}>複数 {st.dub}</span>}
                  </div>
                </button>
                <Ring pct={st.pct} small />
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          {ownedSeries.length === 0 && <div style={S.empty}>まだ所持データがありません。編集タブで枚数を登録してください。</div>}
          {ownedSeries.map((sr) => {
            const stt = seriesStats(sr, get);
            return (
              <button key={sr.id} style={S.seriesCard} onClick={() => setSeriesDetail(sr.id)}>
                <div style={{ flex: 1, textAlign: "left" }}>
                  <div style={S.seriesName}>{sr.name}</div>
                  <div style={S.seriesMeta}>
                    <span style={sr.era === "欅坂46" ? S.badgeKeyaki : S.badgeSakura}>{sr.era}</span>
                    {sr.timing && <span>{sr.timing}</span>}
                  </div>
                  <div style={S.seriesMeta}>
                    {stt.owned}/{stt.total} 所持
                    {stt.comp > 0 && <span style={S.compChip}>コンプ{stt.comp}人</span>}
                  </div>
                  <div style={S.barBg}><div style={{ ...S.barFg, width: stt.pct + "%" }} /></div>
                </div>
                <Ring pct={stt.pct} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════ 編集タブ(下書き→確定) ═══════════ */
function EditTab({ allMembers, allSeries, get, getMeta, memberById, seriesFor, memberStats, commitDraft, addSeries, addMembersToSeries, deleteSeries, showToast }) {
  const [view, setView] = useState("members");
  const [memberDetail, setMemberDetail] = useState(null);
  const [seriesDetail, setSeriesDetail] = useState(null);
  const [addFlow, setAddFlow] = useState(null); // {type:"seriesForMember",memberId} | {type:"membersForSeries",seriesId}

  if (addFlow && addFlow.type === "seriesForMember") {
    const m = memberById(addFlow.memberId);
    return (
      <div>
        <div style={S.gridTop}>
          <button style={S.backBtn} onClick={() => setAddFlow(null)}>‹ 戻る</button>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{m.name} にシリーズを追加</div>
        </div>
        <SeriesForm members={allMembers} initialIds={[addFlow.memberId]}
          onAdd={(sr) => { addSeries(sr); setAddFlow(null); }} />
      </div>
    );
  }
  if (addFlow && addFlow.type === "membersForSeries") {
    const sr = allSeries.find((s) => s.id === addFlow.seriesId);
    return (
      <div>
        <div style={S.gridTop}>
          <button style={S.backBtn} onClick={() => setAddFlow(null)}>‹ 戻る</button>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{sr.name} にメンバーを追加</div>
        </div>
        <AddMembersForm sr={sr} members={allMembers}
          onAdd={(ids) => { addMembersToSeries(sr.id, ids); setAddFlow(null); }}
          onCancel={() => setAddFlow(null)} />
      </div>
    );
  }

  if (view === "members" && memberDetail) {
    const m = memberById(memberDetail);
    const srs = seriesFor(memberDetail);
    return (
      <EditMemberDetail m={m} seriesList={srs} get={get} getMeta={getMeta}
        onCommit={commitDraft} onBack={() => setMemberDetail(null)} showToast={showToast}
        onAddSeries={() => setAddFlow({ type: "seriesForMember", memberId: m.id })} />
    );
  }

  if (view === "series" && seriesDetail) {
    const sr = allSeries.find((s) => s.id === seriesDetail);
    return (
      <EditSeriesDetail sr={sr} allMembers={allMembers} get={get}
        onCommit={commitDraft} onBack={() => setSeriesDetail(null)}
        onDelete={() => { deleteSeries(sr.id); setSeriesDetail(null); }}
        showToast={showToast}
        onAddMembers={() => setAddFlow({ type: "membersForSeries", seriesId: sr.id })} />
    );
  }

  return (
    <div>
      <div style={{ ...S.segment, maxWidth: 220, marginBottom: 12 }}>
        {[["members", "メンバー"], ["series", "シリーズ"]].map(([v, l]) => (
          <button key={v} onClick={() => setView(v)} style={{ ...S.segBtn, ...(view === v ? S.segBtnOn : {}) }}>{l}</button>
        ))}
      </div>
      {view === "members"
        ? <EditMembersList members={allMembers} memberStats={memberStats} onOpen={setMemberDetail} />
        : <EditSeriesList series={allSeries} get={get} allMembers={allMembers} onOpen={setSeriesDetail} onAdd={addSeries} />}
    </div>
  );
}

function EditMembersList({ members, memberStats, onOpen }) {
  const [f, setF] = useState("現役");
  const [q, setQ] = useState("");
  const shown = sortMembers(members).filter((m) => {
    if (q && !m.name.includes(q)) return false;
    if (f === "全員") return true;
    if (f === "現役" || f === "卒業生") return m.status === f;
    if (f === "櫻坂" || f === "欅坂") return (m.groups || []).includes(f);
    return m.gen === Number(f);
  });
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前で検索"
        style={{ ...S.input, width: "100%", marginBottom: 10 }} />
      <div style={{ ...S.chipRow, marginBottom: 12 }}>
        {[["全員", "全員"], ["現役", "現役"], ["卒業生", "卒業生"], ["櫻坂", "櫻坂"], ["欅坂", "欅坂"],
          ["1", "一期"], ["2", "二期"], ["3", "三期"], ["4", "四期"]].map(([v, l]) => (
          <button key={v} onClick={() => setF(v)} style={{ ...S.chip, ...(f === v ? S.chipOn : {}) }}>{l}</button>
        ))}
      </div>
      {shown.map((m) => {
        const st = memberStats(m.id);
        return (
          <button key={m.id} style={{ ...S.memberCard, width: "100%", textAlign: "left", border: "1px solid #F3DCE6" }} onClick={() => onOpen(m.id)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{m.name}</span>
                <span style={S.badgeGen}>{GEN_LABEL[m.gen]}</span>
                <span style={m.status === "現役" ? S.badgeActive : S.badgeGrad}>{m.status}</span>
              </div>
              {st.total > 0 ? <div style={S.seriesMeta}>{st.owned}/{st.total} 所持</div> : <div style={S.seriesMeta}>対象シリーズなし</div>}
            </div>
            {st.total > 0 && <Ring pct={st.pct} small />}
          </button>
        );
      })}
      {shown.length === 0 && <div style={S.empty}>該当するメンバーがいません。</div>}
    </div>
  );
}

function EditSeriesList({ series, get, allMembers, onOpen, onAdd }) {
  const [showForm, setShowForm] = useState(false);
  return (
    <div>
      <button style={{ ...S.primaryBtn, width: "100%", marginBottom: 12 }} onClick={() => setShowForm(!showForm)}>
        {showForm ? "閉じる" : "＋ 新しいシリーズ"}
      </button>
      {showForm && <SeriesForm members={allMembers} onAdd={(sr) => { onAdd(sr); setShowForm(false); }} />}
      {series.length === 0 && !showForm && (
        <div style={S.empty}>まだシリーズがありません。「＋ 新しいシリーズ」から発売単位で追加します。</div>
      )}
      {series.map((sr) => {
        const stt = seriesStats(sr, get);
        return (
          <button key={sr.id} style={S.seriesCard} onClick={() => onOpen(sr.id)}>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={S.seriesName}>{sr.name}</div>
              <div style={S.seriesMeta}>
                <span style={sr.era === "欅坂46" ? S.badgeKeyaki : S.badgeSakura}>{sr.era}</span>
                {sr.timing && <span>{sr.timing}</span>}
              </div>
              <div style={S.seriesMeta}>
                {stt.owned}/{stt.total} 所持
                {stt.comp > 0 && <span style={S.compChip}>コンプ{stt.comp}人</span>}
              </div>
              <div style={S.barBg}><div style={{ ...S.barFg, width: stt.pct + "%" }} /></div>
            </div>
            <Ring pct={stt.pct} />
          </button>
        );
      })}
    </div>
  );
}

function EditMemberDetail({ m, seriesList, get, getMeta, onCommit, onBack, showToast, onAddSeries }) {
  const seed = useMemo(() => {
    const h = {}, me = {};
    seriesList.forEach((sr) => {
      const cuts = sr.cuts || ALL_CUTS;
      memberRows(sr, m.id).forEach((v) => cuts.forEach((c) => {
        const k = hkey(sr.id, m.id, c, v);
        h[k] = get(sr.id, m.id, c, v);
        const mm = getMeta(sr.id, m.id, c, v);
        if (mm && (mm.w || mm.loc || mm.note || mm.priority)) me[k] = mm;
      }));
    });
    return { h, me };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [dH, setDH] = useState(seed.h);
  const [dM, setDM] = useState(seed.me);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState("add");
  const [view, setView] = useState("grid");

  const dGet = (s, mm, c, v) => dH[hkey(s, mm, c, v)] || { n: 0, d: 0, h: 0 };
  const dGetMeta = (s, mm, c, v) => dM[hkey(s, mm, c, v)] || {};
  const tap = (s, mm, c, v) => {
    const k = hkey(s, mm, c, v);
    setDH((prev) => ({ ...prev, [k]: bumpHolding(prev[k], mode) }));
    setDirty(true);
  };
  const setMeta = (s, mm, c, v, patch) => {
    const k = hkey(s, mm, c, v);
    setDM((prev) => ({ ...prev, [k]: patchMeta(prev[k], patch) }));
    setDirty(true);
  };

  const confirm = () => { onCommit(dH, dM); setDirty(false); showToast("確定しました"); };
  const back = () => { if (dirty) showToast("変更を破棄しました"); onBack(); };

  return (
    <div>
      <div style={S.gridTop}>
        <button style={S.backBtn} onClick={back}>‹ 一覧</button>
        <div style={{ flex: 1, minWidth: 0, fontWeight: 900, fontSize: 16 }}>{m.name}</div>
        <button style={{ ...S.primaryBtn, opacity: dirty ? 1 : 0.4 }} disabled={!dirty} onClick={confirm}>確定</button>
      </div>
      <div style={S.controlRow}>
        <div style={{ ...S.segment, maxWidth: 170 }}>
          {[["grid", "表"], ["gallery", "ギャラリー"]].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} style={{ ...S.segBtn, ...(view === v ? S.segBtnOn : {}) }}>{l}</button>
          ))}
        </div>
        {view === "grid" && <ModeSwitch mode={mode} setMode={setMode} />}
      </div>
      {view === "grid" ? (
        <>
          <MemberCutTable m={m} seriesList={seriesList} get={dGet} readOnly={false} onTap={tap} />
          <button style={S.addRowBtn} onClick={onAddSeries}>＋ シリーズを追加</button>
        </>
      ) : (
        <Gallery m={m} series={seriesList} get={dGet} getMeta={dGetMeta} setCellMeta={setMeta} showToast={showToast} />
      )}
    </div>
  );
}

function EditSeriesDetail({ sr, allMembers, get, onCommit, onBack, onDelete, showToast, onAddMembers }) {
  const targets = sortMembers(sr.targetIds.map((id) => allMembers.find((m) => m.id === id)).filter(Boolean));
  const seed = useMemo(() => {
    const h = {};
    const cuts = sr.cuts || ALL_CUTS;
    targets.forEach((m) => memberRows(sr, m.id).forEach((v) => cuts.forEach((c) => { h[hkey(sr.id, m.id, c, v)] = get(sr.id, m.id, c, v); })));
    return h;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [dH, setDH] = useState(seed);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState("add");
  const dGet = (s, m, c, v) => dH[hkey(s, m, c, v)] || { n: 0, d: 0, h: 0 };
  const tap = (s, m, c, v) => { const k = hkey(s, m, c, v); setDH((p) => ({ ...p, [k]: bumpHolding(p[k], mode) })); setDirty(true); };
  const confirm = () => { onCommit(dH, {}); setDirty(false); showToast("確定しました"); };
  const back = () => { if (dirty) showToast("変更を破棄しました"); onBack(); };

  return (
    <div>
      <div style={S.gridTop}>
        <button style={S.backBtn} onClick={back}>‹ 一覧</button>
        <div style={{ ...S.seriesName, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{sr.name}</div>
        <button style={{ ...S.primaryBtn, opacity: dirty ? 1 : 0.4 }} disabled={!dirty} onClick={confirm}>確定</button>
      </div>
      <div style={S.controlRow}>
        <ModeSwitch mode={mode} setMode={setMode} />
        <button style={S.trashBtn} onClick={onDelete}>削除</button>
      </div>
      <SeriesCutTable sr={sr} targets={targets} get={dGet} readOnly={false} onTap={tap} />
      <button style={S.addRowBtn} onClick={onAddMembers}>＋ メンバーを追加</button>
    </div>
  );
}

function AddMembersForm({ sr, members, onAdd, onCancel }) {
  const [ids, setIds] = useState(new Set());
  const candidates = sortMembers(members.filter((m) => !sr.targetIds.includes(m.id)));
  const toggle = (id) => setIds((s) => { const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns; });
  return (
    <div style={S.formCard}>
      <div style={S.formLabel}>追加するメンバー（{ids.size}名選択中）</div>
      <div style={S.pickGrid}>
        {candidates.map((m) => (
          <label key={m.id} style={S.pickItem}>
            <input type="checkbox" checked={ids.has(m.id)} onChange={() => toggle(m.id)} />{m.name}
          </label>
        ))}
        {candidates.length === 0 && <div style={{ fontSize: 12, color: "#A98795" }}>追加できるメンバーがいません（全員登録済み）。</div>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={{ ...S.chip, flex: 1, textAlign: "center" }} onClick={onCancel}>キャンセル</button>
        <button style={{ ...S.primaryBtn, flex: 1 }} disabled={ids.size === 0} onClick={() => onAdd([...ids])}>追加</button>
      </div>
    </div>
  );
}

/* ═══════════ 検索(読み取り専用・MV絞り込み) ═══════════ */
function SearchTab({ state, get, getMeta }) {
  const [selMembers, setSelMembers] = useState(new Set());
  const [selSeries, setSelSeries] = useState(new Set());
  const [selCuts, setSelCuts] = useState(new Set());
  const [selStatus, setSelStatus] = useState(new Set());
  const [mvFilter, setMvFilter] = useState("all"); // all|mv|nonmv
  const [open, setOpen] = useState("member");

  const tgl = (setter) => (v) => setter((s) => { const ns = new Set(s); ns.has(v) ? ns.delete(v) : ns.add(v); return ns; });
  const tM = tgl(setSelMembers), tS = tgl(setSelSeries), tC = tgl(setSelCuts), tSt = tgl(setSelStatus);

  const results = useMemo(() => {
    const out = [];
    state.series.forEach((sr) => {
      if (selSeries.size && !selSeries.has(sr.id)) return;
      const isMV = /MV/.test(sr.name);
      if (mvFilter === "mv" && !isMV) return;
      if (mvFilter === "nonmv" && isMV) return;
      const cuts = sr.cuts || ALL_CUTS;
      sr.targetIds.forEach((mId) => {
        if (selMembers.size && !selMembers.has(mId)) return;
        const m = state.members.find((x) => x.id === mId); if (!m) return;
        memberRows(sr, mId).forEach((v) => {
          cuts.forEach((c) => {
            if (selCuts.size && !selCuts.has(c)) return;
            const val = get(sr.id, mId, c, v);
            const meta = getMeta(sr.id, mId, c, v);
            if (selStatus.size) {
              const ok =
                (selStatus.has("未所持") && val.n === 0) ||
                (selStatus.has("所持") && val.n >= 1) ||
                (selStatus.has("複数所持") && val.n >= 2) ||
                (selStatus.has("難あり") && val.d > 0) ||
                (selStatus.has("高め") && val.h > 0) ||
                (selStatus.has("希望♡") && meta.w);
              if (!ok) return;
            }
            out.push({ sr, m, c, v, val, meta });
          });
        });
      });
    });
    return out.slice(0, 400);
  }, [state, selMembers, selSeries, selCuts, selStatus, mvFilter]);

  const Section = ({ id, title, children }) => (
    <div style={S.searchSec}>
      <button style={S.searchSecHead} onClick={() => setOpen(open === id ? "" : id)}>
        {title} <span>{open === id ? "▲" : "▼"}</span>
      </button>
      {open === id && <div style={{ padding: "8px 10px 10px" }}>{children}</div>}
    </div>
  );

  return (
    <div>
      <Section id="mv" title="MV">
        <div style={S.chipRow}>
          {[["all", "問わない"], ["mv", "MVのみ"], ["nonmv", "MV除く"]].map(([v, l]) => (
            <button key={v} onClick={() => setMvFilter(v)} style={{ ...S.chip, ...(mvFilter === v ? S.chipOn : {}) }}>{l}</button>
          ))}
        </div>
      </Section>
      <Section id="member" title={`メンバー ${selMembers.size ? `(${selMembers.size})` : ""}`}>
        <div style={S.pickGrid}>
          {sortMembers(state.members).map((m) => (
            <label key={m.id} style={S.pickItem}>
              <input type="checkbox" checked={selMembers.has(m.id)} onChange={() => tM(m.id)} />{m.name}
            </label>
          ))}
        </div>
      </Section>
      <Section id="series" title={`シリーズ(時期) ${selSeries.size ? `(${selSeries.size})` : ""}`}>
        {state.series.length === 0 && <div style={{ fontSize: 12, color: "#A98795" }}>シリーズ未登録です</div>}
        {state.series.map((sr) => (
          <label key={sr.id} style={{ ...S.pickItem, display: "flex", width: "100%" }}>
            <input type="checkbox" checked={selSeries.has(sr.id)} onChange={() => tS(sr.id)} />
            {sr.name}（{sr.era}{sr.timing ? "・" + sr.timing : ""}）
          </label>
        ))}
      </Section>
      <Section id="cut" title={`種類 ${selCuts.size ? `(${selCuts.size})` : ""}`}>
        <div style={S.chipRow}>
          {ALL_CUTS.map((c) => (
            <label key={c} style={S.pickItem}>
              <input type="checkbox" checked={selCuts.has(c)} onChange={() => tC(c)} />{c}
            </label>
          ))}
        </div>
      </Section>
      <Section id="status" title={`所持状態 ${selStatus.size ? `(${selStatus.size})` : ""}`}>
        <div style={S.chipRow}>
          {["未所持", "所持", "複数所持", "難あり", "高め", "希望♡"].map((s) => (
            <label key={s} style={S.pickItem}>
              <input type="checkbox" checked={selStatus.has(s)} onChange={() => tSt(s)} />{s}
            </label>
          ))}
        </div>
      </Section>

      <div style={{ ...S.controlRow, marginTop: 12 }}>
        <div style={{ fontSize: 12, color: "#A98795", flex: 1 }}>結果 {results.length} 件</div>
      </div>
      {results.map(({ sr, m, c, v, val, meta }, i) => (
        <div key={i} style={S.resultRow}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>
              {meta.w && <span style={{ color: "#E0447A" }}>♥ </span>}{m.name}
            </span>
            <span style={{ fontSize: 11, color: "#A98795", marginLeft: 6 }}>{sr.name} / {c}{v ? `(${v})` : ""}</span>
            {meta.loc && <div style={{ fontSize: 10, color: "#B99AA8" }}>📍{meta.loc}</div>}
          </div>
          <Cell v={val} readOnly />
        </div>
      ))}
      {results.length === 0 && <div style={S.empty}>条件に一致する生写真がありません。</div>}
    </div>
  );
}

/* ═══════════ 希望タブ(編集・削除のみ) ═══════════ */
function WishTab({ items, setWishMeta }) {
  return (
    <div>
      <div style={S.note}>
        編集タブのギャラリーで♡を付けると、ここに表示されます。優先度とメモの編集、不要になった項目の削除ができます。
      </div>
      <div style={S.dashSecTitle}>希望リスト（{items.length}枚）</div>
      {items.length === 0 && <div style={S.empty}>希望に登録された生写真がありません。編集タブのギャラリーで♡を付けてください。</div>}
      {items.map((q, i) => (
        <WishRow key={i} q={q} setWishMeta={setWishMeta}
          onRemove={() => setWishMeta(q.sr.id, q.m.id, q.c, q.v, { w: false, priority: undefined, note: undefined })} />
      ))}
    </div>
  );
}

function WishRow({ q, setWishMeta, onRemove }) {
  const { sr, m, c, v, priority, note } = q;
  const [editNote, setEditNote] = useState(false);
  const priLabel = PRIORITY_LABEL[priority] || "－";
  const priStyle = priority === 1 ? S.priHigh : priority === 2 ? S.priMid : priority === 3 ? S.priLow : S.priNone;
  return (
    <div style={S.wishRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>
          {m.name} <span style={{ fontWeight: 400, color: "#A98795" }}>／ {c}{v ? `(${v})` : ""}</span>
        </div>
        <div style={{ fontSize: 11, color: "#A98795" }}>{sr.name}</div>
        {editNote ? (
          <input autoFocus defaultValue={note || ""} placeholder="メモ(例: 状態問わず/1枚のみ)"
            style={S.locInput}
            onBlur={(e) => { setWishMeta(sr.id, m.id, c, v, { note: e.target.value.trim() || undefined }); setEditNote(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} />
        ) : note ? (
          <div style={S.wishNote} onClick={() => setEditNote(true)}>📝{note}</div>
        ) : (
          <button style={S.wishNoteBtn} onClick={() => setEditNote(true)}>＋メモ</button>
        )}
      </div>
      <button style={{ ...S.priBtn, ...priStyle }}
        onClick={() => setWishMeta(sr.id, m.id, c, v, { priority: nextPriority(priority) })}>{priLabel}</button>
      <button style={S.wishRemove} onClick={onRemove}>✕</button>
    </div>
  );
}

/* ═══════════ 集計タブ ═══════════ */
function StatsTab({ state, statsOf, get }) {
  return (
    <div>
      <Dashboard state={state} statsOf={statsOf} get={get} />
      <div style={S.dashSec}>
        <div style={S.dashSecTitle}>総所持枚数の週次推移</div>
        <WeeklyChart history={state.history} />
      </div>
    </div>
  );
}

function WeeklyChart({ history }) {
  const weeks = useMemo(() => {
    const byWeek = new Map();
    Object.entries(history || {}).sort(([a], [b]) => (a < b ? -1 : 1)).forEach(([date, total]) => {
      byWeek.set(isoWeekKey(date), total);
    });
    return [...byWeek.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [history]);

  if (weeks.length === 0) {
    return <div style={S.empty}>記録がまだありません。編集タブで確定すると、その週の総所持枚数が記録されます。</div>;
  }

  const W = 320, H = 120, pad = 12;
  const max = Math.max(1, ...weeks.map(([, v]) => v));
  const stepX = weeks.length > 1 ? (W - pad * 2) / (weeks.length - 1) : 0;
  const pts = weeks.map(([, v], i) => {
    const x = pad + i * stepX;
    const y = H - pad - (v / max) * (H - pad * 2);
    return [x, y];
  });
  const path = pts.map(([x, y], i) => (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1)).join(" ");

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <path d={path} fill="none" stroke="#C64B7C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill="#C64B7C" />)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#B99AA8" }}>
        <span>{weeks[0][0]}</span>
        <span>{weeks[weeks.length - 1][1]}枚</span>
        <span>{weeks[weeks.length - 1][0]}</span>
      </div>
    </div>
  );
}

/* ═══════════ ダッシュボード(統計) ═══════════ */
function Dashboard({ state, statsOf, get }) {
  const agg = useMemo(() => {
    let sheets = 0, kinds = 0, total = 0, dub = 0, dmg = 0, high = 0, comp = 0, semi = 0, wish = 0;
    const perMember = [];
    state.members.forEach((m) => {
      const st = statsOf(m.id);
      let sheetsM = 0;
      state.series.forEach((sr) => {
        if (!sr.targetIds.includes(m.id)) return;
        const cuts = sr.cuts || ALL_CUTS;
        memberRows(sr, m.id).forEach((v) => cuts.forEach((c) => { sheetsM += get(sr.id, m.id, c, v).n; }));
      });
      sheets += sheetsM; kinds += st.owned; total += st.total;
      dub += st.dub; dmg += st.dmg; high += st.high; comp += st.comp; semi += st.semi;
      if (st.total > 0) perMember.push({ m, owned: st.owned, total: st.total, sheets: sheetsM, pct: st.pct, comp: st.comp });
    });
    Object.entries(state.meta).forEach(([k, v]) => {
      if (v.w && (state.holdings[k]?.n || 0) === 0) wish++;
    });
    const genAgg = {};
    perMember.forEach(({ m, owned, total }) => {
      genAgg[m.gen] = genAgg[m.gen] || { owned: 0, total: 0 };
      genAgg[m.gen].owned += owned; genAgg[m.gen].total += total;
    });
    perMember.sort((a, b) => b.sheets - a.sheets || b.pct - a.pct);
    return { sheets, kinds, total, dub, dmg, high, comp, semi, wish, perMember, genAgg, nSeries: state.series.length };
  }, [state]);

  const Stat = ({ label, value, sub, accent }) => (
    <div style={S.statCard}>
      <div style={{ fontSize: 11, color: "#A98795", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: accent || "#3A2A33", lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "#B99AA8" }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <div style={S.statGrid}>
        <Stat label="総所持枚数" value={agg.sheets + "枚"} sub={`${agg.kinds}種 / 全${agg.total}種`} accent="#C64B7C" />
        <Stat label="シリーズ" value={agg.nSeries} sub="登録数" />
        <Stat label="コンプ" value={agg.comp} sub={`セミコンプ ${agg.semi}`} accent="#C64B7C" />
        <Stat label="複数所持" value={agg.dub + "枚"} sub={`難あり ${agg.dmg}枚 ・ 高め ${agg.high}枚 ・ 希望♡ ${agg.wish}`} />
      </div>

      {Object.keys(agg.genAgg).length > 0 && (
        <div style={S.dashSec}>
          <div style={S.dashSecTitle}>期別の所持率</div>
          {Object.entries(agg.genAgg).sort().map(([g, v]) => {
            const pct = v.total ? Math.round((v.owned / v.total) * 100) : 0;
            return (
              <div key={g} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, color: "#8A5A6E" }}>{GEN_LABEL[g] || g + "期"}</span>
                  <span style={{ color: "#A98795" }}>{v.owned}/{v.total}（{pct}%）</span>
                </div>
                <div style={S.barBg}><div style={{ ...S.barFg, width: pct + "%" }} /></div>
              </div>
            );
          })}
        </div>
      )}

      <div style={S.dashSec}>
        <div style={S.dashSecTitle}>メンバー別 所持枚数ランキング</div>
        {agg.perMember.length === 0 && (
          <div style={{ fontSize: 12, color: "#A98795" }}>編集タブでシリーズを登録して枚数を記録すると集計が表示されます。</div>
        )}
        {agg.perMember.slice(0, 10).map(({ m, sheets, pct, comp }, i) => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
            <span style={{ width: 20, textAlign: "center", fontWeight: 900, color: i < 3 ? "#C64B7C" : "#C7A5B4", fontSize: 13 }}>{i + 1}</span>
            <span style={{ width: 92, fontSize: 12.5, fontWeight: 700, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{m.name}</span>
            <div style={{ flex: 1 }}>
              <div style={S.barBg}><div style={{ ...S.barFg, width: pct + "%" }} /></div>
            </div>
            <span style={{ fontSize: 11, color: "#A98795", width: 58, textAlign: "right" }}>{sheets}枚 {comp > 0 ? `👑${comp}` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Sample_Photo/ 内の同名画像を探して表示する拡張子フォールバック付き<img>
   fallback="text": 見つからない場合に説明文を表示(詳細画面向け) / "blank": 淡色の空枠のみ(一覧の小サムネ向け) */
const PHOTO_EXTS = ["png", "jpg", "jpeg", "webp"];
/* Sample_Photo/ のファイル名は保存時に " ' / が "_" に置換され、? ／？ は削除されている
   (例: Nobody's fault → Nobody_s fault / "Addiction" → _Addiction_)。
   元の品目名でまず探し、見つからなければサニタイズ後の名前でも試す。 */
function sanitizePhotoName(name) {
  return name.replace(/["'/]/g, "_").replace(/[?？]/g, "");
}

function SamplePhotoImg({ name, style, fallback = "text" }) {
  const candidates = useMemo(() => {
    const sanitized = sanitizePhotoName(name);
    const names = sanitized === name ? [name] : [name, sanitized];
    // 拡張子優先(実ファイルはpng)で並べ、該当なしパターンでの往復回数を減らす
    const out = [];
    PHOTO_EXTS.forEach((ext) => names.forEach((n) => out.push(`${n}.${ext}`)));
    return out;
  }, [name]);
  const [idx, setIdx] = useState(0);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => { setIdx(0); setNotFound(false); }, [name]);

  if (notFound) {
    return fallback === "blank"
      ? <div style={{ ...style, background: "#F3DCE6" }} />
      : <div style={S.catPreviewNone}>./Sample_Photo/{name}.* が見つかりません</div>;
  }
  return (
    <img
      src={`./Sample_Photo/${encodeURIComponent(candidates[idx])}`}
      alt={name}
      style={style}
      onError={() => {
        if (idx < candidates.length - 1) setIdx((i) => i + 1);
        else setNotFound(true);
      }}
    />
  );
}

/* カタログ1行: サムネイルを常時表示(タップ不要) */
function CatalogItem({ item, onPick }) {
  return (
    <button style={S.catRow} onClick={() => onPick(item)}>
      <SamplePhotoImg name={item.name} style={S.catThumb} fallback="blank" />
      <span style={S.catDate}>{item.date}</span>
      <span style={S.catNameText}>{item.name}</span>
      {item.autograph && <span style={S.autographBadge}>直筆</span>}
      {item.isMV && <span style={S.mvBadge}>MV</span>}
      {item.labels.includes("選抜") && <span style={S.labelSenbatsu}>選抜</span>}
      {item.labels.includes("BACKS") && <span style={S.labelBacks}>BACKS</span>}
      {item.labels.filter((l) => l !== "選抜" && l !== "BACKS").map((l) => (
        <span key={l} style={S.badgeGen}>{l}</span>
      ))}
    </button>
  );
}

function SeriesForm({ members, onAdd, initialIds }) {
  const [name, setName] = useState("");
  const [era, setEra] = useState("櫻坂46");
  const [timing, setTiming] = useState("");
  const [cuts, setCuts] = useState(ALL_CUTS);
  const [memberVariants, setMemberVariants] = useState({});
  const [ids, setIds] = useState(new Set(
    initialIds && initialIds.length ? initialIds : members.filter((m) => m.status === "現役").map((m) => m.id)
  ));
  const [openPick, setOpenPick] = useState(false);
  const [openCat, setOpenCat] = useState(true);
  const [catQ, setCatQ] = useState("");

  const setGroup = (fn) => setIds(new Set(members.filter(fn).map((m) => m.id)));
  const toggle = (id) => setIds((s) => { const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns; });

  const memberIdByName = useMemo(() => new Map(members.map((m) => [m.name, m.id])), [members]);
  // メンバー起点(initialIds)の追加では、そのメンバーが参加していないカタログ項目は出さない
  const initiatingMember = initialIds && initialIds.length === 1
    ? members.find((m) => m.id === initialIds[0])
    : null;

  const catalog = useMemo(() => {
    let list = [...PHOTO_CATALOG].reverse(); // 新しい順
    if (initiatingMember) {
      list = list.filter((it) => it.members.some((mm) => mm.name === initiatingMember.name));
    }
    if (!catQ.trim()) return list;
    return list.filter((it) => it.name.includes(catQ) || it.date.includes(catQ));
  }, [catQ, initiatingMember]);

  const pickCatalog = (item) => {
    setName(item.name);
    setTiming(item.date);
    setEra("櫻坂46");
    const matchedIds = [...new Set(item.members.map((mm) => memberIdByName.get(mm.name)).filter(Boolean))];
    if (initialIds && initialIds.length) {
      setIds(new Set([...(matchedIds.length ? matchedIds : []), ...initialIds]));
    } else if (matchedIds.length > 0) setIds(new Set(matchedIds));
    else if (item.name.includes("三期生")) setGroup((m) => m.gen === 3);
    else if (item.name.includes("四期生")) setGroup((m) => m.gen === 4);
    setCuts(item.cuts);

    // 同一メンバーが複数variant(衣装違い)を持つ場合は memberVariants に記録
    const countByName = {};
    item.members.forEach((mm) => { countByName[mm.name] = (countByName[mm.name] || 0) + 1; });
    const variantMap = {};
    item.members.forEach((mm) => {
      if (countByName[mm.name] > 1) {
        const mid = memberIdByName.get(mm.name); if (!mid) return;
        variantMap[mid] = variantMap[mid] || [];
        variantMap[mid].push(mm.variant || "");
      }
    });
    setMemberVariants(variantMap);
    setOpenCat(false);
  };

  const compact = !!(initialIds && initialIds.length); // メンバー起点の追加: カタログ選択のみで完結させる

  return (
    <div style={S.formCard}>
      {!compact && (
        <button style={{ ...S.chip, ...(openCat ? S.chipOn : {}), marginBottom: 8 }}
          onClick={() => setOpenCat(!openCat)}>
          📚 発売リストから選ぶ {openCat ? "▲" : "▼"}
        </button>
      )}
      {(compact || openCat) && (
        <div style={{ marginBottom: compact ? 0 : 12 }}>
          <input value={catQ} onChange={(e) => setCatQ(e.target.value)}
            placeholder="品目名や年で検索（例: Addiction / 2025）"
            style={{ ...S.input, width: "100%", marginBottom: 6 }} />
          <div style={S.catList}>
            {catalog.map((item, i) => (
              <CatalogItem key={i} item={item} onPick={pickCatalog} />
            ))}
            {catalog.length === 0 && <div style={{ fontSize: 12, color: "#A98795", padding: 8 }}>該当なし</div>}
          </div>
        </div>
      )}

      {compact ? (
        name && <div style={{ ...S.note, marginTop: 10 }}>選択中: {name}</div>
      ) : (
        <>
          <label style={S.formLabel}>シリーズ名</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="例: Lonesome rabbit ジャケット写真衣装" style={{ ...S.input, width: "100%" }} />
          <label style={{ ...S.formLabel, marginTop: 10 }}>グループ</label>
          <select value={era} onChange={(e) => setEra(e.target.value)} style={S.select}>
            <option>櫻坂46</option><option>欅坂46</option>
          </select>

          <label style={S.formLabel}>対象メンバー（{ids.size}名選択中）</label>
          <div style={S.chipRow}>
            <button style={S.chip} onClick={() => setGroup(() => true)}>全員</button>
            <button style={S.chip} onClick={() => setGroup((m) => m.status === "現役")}>現役全員</button>
            <button style={S.chip} onClick={() => setGroup((m) => (m.groups || []).includes("櫻坂"))}>櫻坂在籍</button>
            <button style={S.chip} onClick={() => setGroup((m) => (m.groups || []).includes("欅坂"))}>欅坂在籍</button>
            {[1, 2, 3, 4].map((g) => (
              <button key={g} style={S.chip} onClick={() => setGroup((m) => m.gen === g)}>{GEN_LABEL[g]}のみ</button>
            ))}
            <button style={S.chip} onClick={() => setIds(new Set())}>クリア</button>
          </div>
          <button style={{ ...S.chip, marginTop: 6, ...(openPick ? S.chipOn : {}) }} onClick={() => setOpenPick(!openPick)}>
            個別に選ぶ {openPick ? "▲" : "▼"}
          </button>
          {openPick && (
            <div style={S.pickGrid}>
              {sortMembers(members).map((m) => (
                <label key={m.id} style={{ ...S.pickItem, opacity: m.status === "卒業生" ? 0.75 : 1 }}>
                  <input type="checkbox" checked={ids.has(m.id)} onChange={() => toggle(m.id)} />
                  {m.name}
                </label>
              ))}
            </div>
          )}
        </>
      )}

      <button style={{ ...S.primaryBtn, width: "100%", marginTop: 12 }}
        onClick={() => {
          if (!name.trim() || ids.size === 0) return;
          onAdd({
            id: "s" + Date.now(), name: name.trim(), era, timing: timing.trim(),
            targetIds: [...ids], cuts,
            memberVariants: Object.keys(memberVariants).length ? memberVariants : undefined,
          });
        }}>
        このシリーズを追加
      </button>
    </div>
  );
}

/* ═══════════ ギャラリー(編集タブ内・下書き対応) ═══════════ */
function Gallery({ m, series, get, getMeta, setCellMeta, showToast }) {
  const [imgs, setImgs] = useState({});      // key -> dataURL
  const [editLoc, setEditLoc] = useState(null); // key being edited
  const fileRef = useRef(null);
  const targetRef = useRef(null);

  const cells = useMemo(() => {
    const out = [];
    series.forEach((sr) => {
      const cuts = sr.cuts || ALL_CUTS;
      memberRows(sr, m.id).forEach((v) => cuts.forEach((c) => out.push({ sr, c, v, k: hkey(sr.id, m.id, c, v) })));
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, m.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const loaded = {};
      for (const { k } of cells) {
        try {
          const r = await storage.get(imgKey(k));
          if (r && r.value) loaded[k] = r.value;
        } catch (e) { /* 画像なし */ }
      }
      if (alive) setImgs(loaded);
    })();
    return () => { alive = false; };
  }, [cells]);

  const pickImage = (k) => { targetRef.current = k; fileRef.current && fileRef.current.click(); };

  const onFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    const k = targetRef.current;
    if (!file || !k) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      const MAX = 420;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const dataUrl = cv.toDataURL("image/jpeg", 0.72);
      URL.revokeObjectURL(url);
      try {
        await storage.set(imgKey(k), dataUrl);
        setImgs((s) => ({ ...s, [k]: dataUrl }));
        showToast("画像を保存しました");
      } catch (err) { showToast("画像の保存に失敗しました"); }
    };
    img.src = url;
  };

  const removeImage = async (k) => {
    try { await storage.delete(imgKey(k)); } catch (e) { /* noop */ }
    setImgs((s) => { const ns = { ...s }; delete ns[k]; return ns; });
  };

  if (cells.length === 0) return <div style={S.empty}>対象シリーズがありません。</div>;

  return (
    <div>
      <div style={S.note}>
        写真をタップで画像を添付（見た目のメモ用）。♡＝この写真が欲しい（希望タブに反映、確定が必要）。📍＝保管場所。
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile} />
      <div style={S.galleryGrid}>
        {cells.map(({ sr, c, v, k }) => {
          const val = get(sr.id, m.id, c, v);
          const meta = getMeta(sr.id, m.id, c, v);
          const img = imgs[k];
          return (
            <div key={k} style={{ ...S.photoCard, opacity: val.n === 0 && !meta.w ? 0.85 : 1 }}>
              <button style={S.photoArea} onClick={() => pickImage(k)}>
                {img
                  ? <img src={img} alt="" style={S.photoImg} />
                  : <div style={S.photoPlaceholder}>
                      <span style={{ fontSize: 22 }}>{val.n > 0 ? "🌸" : "＋"}</span>
                      <span style={{ fontSize: 10 }}>{val.n > 0 ? "画像を添付" : "未所持"}</span>
                    </div>}
                {val.n >= 2 && <span style={S.photoCount}>×{val.n}</span>}
                {val.d > 0 && <span style={{ ...S.photoCount, left: 6, right: "auto", background: "#E8A54B" }}>⚠{val.d}</span>}
                {img && <span style={S.photoRemove} onClick={(e) => { e.stopPropagation(); removeImage(k); }}>✕</span>}
              </button>
              <div style={S.photoLabel}>
                <span style={S.photoLabelMark}>🌸</span>
                <span style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                  {m.name}<span style={{ color: "#C7A5B4" }}>／{c}{v ? `(${v})` : ""}</span>
                </span>
              </div>
              <div style={S.photoSeries}>{sr.name}</div>
              <div style={S.photoActions}>
                <button
                  onClick={() => setCellMeta(sr.id, m.id, c, v, { w: !meta.w })}
                  style={{ ...S.heartBtn, color: meta.w ? "#E0447A" : "#DCC3CF" }}>
                  {meta.w ? "♥ 希望" : "♡ 希望"}
                </button>
                <button onClick={() => setEditLoc(editLoc === k ? null : k)}
                  style={{ ...S.locBtn, color: meta.loc ? "#8A5A6E" : "#C7A5B4" }}>
                  📍{meta.loc ? "" : " 保管場所"}
                </button>
              </div>
              {meta.loc && editLoc !== k && (
                <div style={S.locText} onClick={() => setEditLoc(k)}>{meta.loc}</div>
              )}
              {editLoc === k && (
                <input autoFocus defaultValue={meta.loc || ""}
                  placeholder="例: バインダーA p.3"
                  style={S.locInput}
                  onBlur={(e) => { setCellMeta(sr.id, m.id, c, v, { loc: e.target.value.trim() }); setEditLoc(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════ styles ═══════════ */
const S = {
  app: {
    fontFamily: "'Zen Maru Gothic','Hiragino Maru Gothic ProN','Hiragino Sans','Noto Sans JP',sans-serif",
    background: "#FFF6F9", minHeight: "100vh", maxWidth: 480, margin: "0 auto",
    color: "#3A2A33", paddingBottom: 84,
  },
  header: {
    padding: "18px 16px 10px", borderBottom: "1px solid #F3DCE6",
    background: "linear-gradient(180deg,#FFEDF4,#FFF6F9)", position: "sticky", top: 0, zIndex: 5,
  },
  logoRow: { display: "flex", alignItems: "center", gap: 7 },
  logoText: { fontSize: 20, fontWeight: 900, letterSpacing: "0.02em", color: "#C64B7C" },
  logoSub: { fontSize: 11, color: "#A98795", marginLeft: 29 },
  logoutBtn: { marginLeft: "auto", border: "none", background: "transparent", color: "#B99AA8", fontSize: 16, padding: 4, cursor: "pointer" },
  main: { padding: "14px 14px 0" },

  input: { padding: "10px 12px", borderRadius: 12, border: "1.5px solid #EBCBD9", background: "#fff", fontSize: 14, minWidth: 0 },
  select: { width: "100%", padding: "10px 12px", borderRadius: 12, border: "1.5px solid #EBCBD9", background: "#fff", fontSize: 14, marginBottom: 12 },
  primaryBtn: { padding: "10px 16px", borderRadius: 12, border: "none", background: "#C64B7C", color: "#fff", fontWeight: 700, fontSize: 14, flexShrink: 0 },
  addRowBtn: { width: "100%", border: "1.5px dashed #EBCBD9", background: "#fff", color: "#C64B7C", borderRadius: 12, padding: "10px 12px", fontSize: 13, fontWeight: 700, marginTop: 10 },
  empty: { padding: "26px 16px", textAlign: "center", color: "#A98795", fontSize: 13, lineHeight: 1.7, background: "#fff", borderRadius: 14, border: "1.5px dashed #EBCBD9", marginBottom: 10 },
  note: { fontSize: 12, color: "#8A5A6E", background: "#FBE4EC", borderRadius: 10, padding: "9px 12px", marginBottom: 12, lineHeight: 1.6 },

  chipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { border: "1.5px solid #EBCBD9", background: "#fff", color: "#A9758C", borderRadius: 999, padding: "5px 11px", fontSize: 12, fontWeight: 700 },
  chipOn: { background: "#C64B7C", borderColor: "#C64B7C", color: "#fff" },

  badgeGen: { background: "#F3E3EB", color: "#8A5A6E", borderRadius: 6, padding: "1px 6px", fontSize: 10, fontWeight: 700, flexShrink: 0 },
  badgeActive: { background: "#E4F3E8", color: "#3E7D52", borderRadius: 6, padding: "1px 6px", fontSize: 10, fontWeight: 700, flexShrink: 0 },
  badgeGrad: { background: "#EFEAF3", color: "#71618A", borderRadius: 6, padding: "1px 6px", fontSize: 10, fontWeight: 700, flexShrink: 0 },
  badgeSakura: { background: "#FBE4EC", color: "#C64B7C", borderRadius: 6, padding: "1px 6px", fontSize: 10, fontWeight: 700 },
  badgeKeyaki: { background: "#E7F0E4", color: "#4A7A3D", borderRadius: 6, padding: "1px 6px", fontSize: 10, fontWeight: 700 },
  mvBadge: { flexShrink: 0, background: "#7B5EA7", color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 10, fontWeight: 800 },
  labelSenbatsu: { flexShrink: 0, background: "#C64B7C", color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 10, fontWeight: 800 },
  labelBacks: { flexShrink: 0, background: "#4A7A3D", color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 10, fontWeight: 800 },
  compChip: { background: "#C64B7C", color: "#fff", borderRadius: 999, padding: "1px 8px", fontSize: 10, fontWeight: 800 },
  semiChip: { background: "#F3B7CF", color: "#8A2F58", borderRadius: 999, padding: "1px 8px", fontSize: 10, fontWeight: 800 },

  statGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 },
  statCard: { background: "#fff", border: "1.5px solid #F3DCE6", borderRadius: 14, padding: "11px 13px" },
  dashSec: { background: "#fff", border: "1.5px solid #F3DCE6", borderRadius: 16, padding: "13px 14px", marginBottom: 12 },
  dashSecTitle: { fontSize: 12.5, fontWeight: 800, color: "#C64B7C", marginBottom: 10 },

  memberCard: { display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #F3DCE6", borderRadius: 14, padding: "9px 12px", marginBottom: 7 },
  memberMain: { flex: 1, minWidth: 0, border: "none", background: "transparent", textAlign: "left", padding: 0, display: "flex", flexDirection: "column", gap: 3 },
  starBtn: { border: "none", background: "transparent", fontSize: 20, lineHeight: 1, padding: 0, flexShrink: 0 },

  seriesCard: { display: "flex", alignItems: "center", gap: 12, width: "100%", background: "#fff", border: "1.5px solid #F3DCE6", borderRadius: 16, padding: "13px 14px", marginBottom: 10, textAlign: "left", boxShadow: "0 2px 8px rgba(198,75,124,0.06)" },
  seriesName: { fontWeight: 700, fontSize: 14.5, color: "#3A2A33" },
  seriesMeta: { fontSize: 12, color: "#A98795", margin: "3px 0 5px", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" },
  dubTag: { background: "#C64B7C", color: "#fff", borderRadius: 999, padding: "1px 8px", fontSize: 10.5, fontWeight: 700 },
  barBg: { height: 6, background: "#F3DCE6", borderRadius: 999, overflow: "hidden" },
  barFg: { height: "100%", background: "linear-gradient(90deg,#E56C97,#C64B7C)", borderRadius: 999, transition: "width .3s" },

  formCard: { background: "#fff", border: "1.5px solid #F3DCE6", borderRadius: 16, padding: 14, marginBottom: 14 },
  formLabel: { display: "block", fontSize: 11.5, fontWeight: 800, color: "#A9758C", marginBottom: 5 },
  pickGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 8px", marginTop: 8, maxHeight: 260, overflowY: "auto", background: "#FFF9FB", border: "1px solid #F3DCE6", borderRadius: 12, padding: 10 },
  pickItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "3px 0" },
  catList: { maxHeight: 280, overflowY: "auto", background: "#FFF9FB", border: "1px solid #F3DCE6", borderRadius: 12, padding: 4 },
  catRow: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, width: "100%", border: "none", background: "transparent", padding: "6px 6px", fontSize: 12, borderRadius: 8, color: "#3A2A33", borderBottom: "1px solid #F9EBF1", textAlign: "left" },
  catThumb: { width: 30, height: 39, borderRadius: 6, objectFit: "cover", flexShrink: 0, border: "1px solid #F3DCE6" },
  catDate: { fontSize: 10.5, color: "#C64B7C", fontWeight: 800, flexShrink: 0, width: 62, textAlign: "left" },
  catNameText: { flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  autographBadge: { flexShrink: 0, background: "#E8A54B", color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 10, fontWeight: 800 },
  catPreviewImg: { width: "100%", maxWidth: 220, borderRadius: 10, border: "1px solid #F3DCE6", display: "block" },
  zoomTrigger: { border: "none", background: "transparent", padding: 0, display: "block", cursor: "zoom-in" },
  zoomOverlay: { position: "fixed", inset: 0, background: "rgba(30,16,22,0.82)", display: "grid", placeItems: "center", zIndex: 40, padding: 20, cursor: "zoom-out" },
  zoomImg: { maxWidth: "92vw", maxHeight: "88vh", width: "auto", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", display: "block" },
  catPreviewNone: { fontSize: 11, color: "#B99AA8", padding: "6px 2px" },

  gridTop: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 },
  backBtn: { border: "none", background: "#FBE4EC", color: "#C64B7C", fontWeight: 700, borderRadius: 10, padding: "8px 11px", fontSize: 13, flexShrink: 0 },
  trashBtn: { border: "none", background: "transparent", color: "#C7A5B4", fontSize: 12, flexShrink: 0, textDecoration: "underline" },
  controlRow: { display: "flex", gap: 8, marginBottom: 10, alignItems: "center" },
  segment: { display: "flex", background: "#F7E3EC", borderRadius: 11, padding: 3, flex: 1, maxWidth: 220 },
  segBtn: { flex: 1, border: "none", background: "transparent", borderRadius: 8, padding: "6px 4px", fontSize: 11.5, color: "#A9758C", fontWeight: 700, whiteSpace: "nowrap" },
  segBtnOn: { background: "#fff", color: "#C64B7C", boxShadow: "0 1px 3px rgba(198,75,124,0.2)" },
  shotBtn: { border: "1.5px solid #EBCBD9", background: "#fff", color: "#A9758C", borderRadius: 11, padding: "7px 10px", fontWeight: 700, fontSize: 13, flexShrink: 0 },
  legend: { display: "flex", gap: 12, fontSize: 11, color: "#A98795", marginBottom: 8, paddingLeft: 2, flexWrap: "wrap" },
  dot: { display: "inline-block", width: 11, height: 11, borderRadius: 4, marginRight: 4, verticalAlign: -1 },

  gridHead: { display: "grid", gridTemplateColumns: "1fr 46px 46px 46px 46px", gap: 5, fontSize: 11, color: "#A9758C", padding: "4px 2px", position: "sticky", top: 64, background: "#FFF6F9", zIndex: 4 },
  cutHead: { textAlign: "center", fontWeight: 700 },
  gridRow: { display: "grid", gridTemplateColumns: "1fr 46px 46px 46px 46px", gap: 5, alignItems: "center", marginBottom: 6 },
  nameCol: { fontSize: 13, overflow: "hidden", lineHeight: 1.35 },
  cell: { height: 40, borderRadius: 10, fontSize: 12.5, fontWeight: 800, border: "none" },
  cellZero: { background: "#fff", border: "1.5px dashed #DDB9C8", color: "transparent" },
  cellOne: { background: "#F7CBDC", color: "#9C3D66" },
  cellDub: { background: "#C64B7C", color: "#fff" },
  cellNone: { height: 40, display: "grid", placeItems: "center", color: "#E5CBD8", fontSize: 12 },
  dmgBadge: { position: "absolute", top: -5, right: -4, fontSize: 10, background: "#E8A54B", color: "#fff", borderRadius: 999, padding: "0 4px", lineHeight: "14px" },
  highBadge: { position: "absolute", bottom: -5, right: -4, fontSize: 10, background: "#7B5EA7", color: "#fff", borderRadius: 999, padding: "0 4px", lineHeight: "14px" },

  /* ギャラリー(公式サンプル風カード) */
  galleryGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  photoCard: { background: "#fff", border: "1.5px solid #F3DCE6", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 6px rgba(198,75,124,0.07)", display: "flex", flexDirection: "column" },
  photoArea: { position: "relative", width: "100%", aspectRatio: "89 / 116", border: "none", background: "#FBF0F5", padding: 0, display: "block" },
  photoImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  photoPlaceholder: { width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, color: "#C7A5B4" },
  photoCount: { position: "absolute", top: 6, right: 6, background: "#C64B7C", color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 11, fontWeight: 800 },
  photoRemove: { position: "absolute", bottom: 6, right: 6, background: "rgba(58,42,51,0.55)", color: "#fff", borderRadius: 999, width: 20, height: 20, display: "grid", placeItems: "center", fontSize: 10 },
  photoLabel: { display: "flex", alignItems: "center", gap: 4, borderTop: "1px solid #F3DCE6", padding: "5px 8px 2px", fontSize: 11.5, fontWeight: 800, color: "#3A2A33" },
  photoLabelMark: { fontSize: 9 },
  photoSeries: { padding: "0 8px", fontSize: 9.5, color: "#B99AA8", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
  photoActions: { display: "flex", gap: 4, padding: "5px 6px 7px" },
  heartBtn: { flex: 1, border: "1px solid #F3DCE6", background: "#fff", borderRadius: 8, padding: "4px 0", fontSize: 11, fontWeight: 800 },
  locBtn: { flex: 1, border: "1px solid #F3DCE6", background: "#fff", borderRadius: 8, padding: "4px 0", fontSize: 11, fontWeight: 700, overflow: "hidden", whiteSpace: "nowrap" },
  locText: { padding: "0 8px 8px", fontSize: 10.5, color: "#8A5A6E" },
  locInput: { margin: "0 6px 8px", padding: "6px 8px", borderRadius: 8, border: "1.5px solid #EBCBD9", fontSize: 12 },

  searchSec: { background: "#fff", border: "1.5px solid #F3DCE6", borderRadius: 14, marginBottom: 8, overflow: "hidden" },
  searchSecHead: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", border: "none", background: "transparent", padding: "11px 13px", fontWeight: 800, fontSize: 13, color: "#8A5A6E" },
  resultRow: { display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #F3DCE6", borderRadius: 12, padding: "7px 11px", marginBottom: 6 },

  wishRow: { display: "flex", alignItems: "flex-start", gap: 8, background: "#fff", border: "1px solid #F3DCE6", borderRadius: 12, padding: "9px 11px", marginBottom: 7 },
  wishNote: { fontSize: 11, color: "#8A5A6E", marginTop: 3, cursor: "pointer" },
  wishNoteBtn: { border: "none", background: "transparent", color: "#C7A5B4", fontSize: 11, fontWeight: 700, padding: 0, marginTop: 3 },
  wishRemove: { border: "none", background: "transparent", color: "#C7A5B4", fontSize: 13, flexShrink: 0, padding: "2px 4px" },
  priBtn: { border: "1.5px solid #EBCBD9", background: "#fff", color: "#A9758C", borderRadius: 999, padding: "4px 10px", fontSize: 11.5, fontWeight: 800, flexShrink: 0 },
  priHigh: { background: "#C64B7C", borderColor: "#C64B7C", color: "#fff" },
  priMid: { background: "#F3B7CF", borderColor: "#F3B7CF", color: "#8A2F58" },
  priLow: { background: "#F3E3EB", borderColor: "#F3E3EB", color: "#8A5A6E" },
  priNone: { color: "#DCC3CF" },

  tabbar: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, display: "flex", background: "rgba(255,255,255,0.96)", backdropFilter: "blur(8px)", borderTop: "1px solid #F3DCE6", padding: "6px 6px calc(8px + env(safe-area-inset-bottom))", zIndex: 10 },
  tabBtn: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, border: "none", background: "transparent", color: "#B99AA8", fontSize: 9.5, fontWeight: 700, padding: "6px 0", borderRadius: 12 },
  tabBtnOn: { color: "#C64B7C", background: "#FBE4EC" },

  toast: { position: "fixed", bottom: 86, left: "50%", transform: "translateX(-50%)", background: "#3A2A33", color: "#fff", borderRadius: 999, padding: "8px 18px", fontSize: 13, zIndex: 20, whiteSpace: "nowrap" },

  shotBg: { minHeight: "100vh", background: "#FFF0F6", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 18, cursor: "pointer", fontFamily: "'Zen Maru Gothic','Hiragino Maru Gothic ProN','Hiragino Sans',sans-serif", color: "#3A2A33", maxWidth: 480, margin: "0 auto" },
  shotCard: { background: "#fff", borderRadius: 20, padding: 18, width: "100%", boxShadow: "0 6px 24px rgba(198,75,124,0.15)", border: "1.5px solid #F7CBDC" },
  shotHead: { display: "flex", alignItems: "center", gap: 7, marginBottom: 12, flexWrap: "wrap" },
  shotFoot: { textAlign: "right", fontSize: 10, color: "#DDB9C8", fontWeight: 700, marginTop: 10 },
  shotHint: { fontSize: 12, color: "#A98795", marginTop: 12 },
};
