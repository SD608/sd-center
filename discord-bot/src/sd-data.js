import { createClient } from "@supabase/supabase-js";

let client = null;

function getClient() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.");
  }

  client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return client;
}

export function formatWon(value) {
  const number = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `${Math.trunc(number).toLocaleString("ko-KR")}원`;
}

function balanceOf(member) {
  return Number.isFinite(Number(member?.balance)) ? Number(member.balance) : 0;
}

export function applyRanks(members) {
  const sorted = [...members].sort((a, b) => {
    const diff = balanceOf(b) - balanceOf(a);
    return diff !== 0
      ? diff
      : String(a.nickname || "").localeCompare(String(b.nickname || ""), "ko");
  });

  let lastBalance = null;
  let lastRank = 0;
  return sorted.map((member, index) => {
    const balance = balanceOf(member);
    if (lastBalance === null || balance !== lastBalance) {
      lastBalance = balance;
      lastRank = index + 1;
    }
    return { ...member, balance, rank: lastRank };
  });
}

export async function loadRankedMembers() {
  const supabase = getClient();
  const { data, error } = await supabase.rpc("list_sd_member_wallets");
  if (error) throw error;

  const members = Array.isArray(data) ? data : [];
  return applyRanks(members.filter((member) => member?.role !== "admin"));
}

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase("ko-KR");
}

export function findMemberByNames(members, names) {
  const normalized = [...new Set(names.map(normalizeName).filter(Boolean))];
  if (!normalized.length) return null;

  for (const name of normalized) {
    const exact = members.find((member) => normalizeName(member.nickname) === name);
    if (exact) return exact;
  }
  return null;
}
