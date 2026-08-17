// Multi-channel YouTube account storage.
//
// Stores one OAuth token-set per connected channel in data/youtube-accounts.json,
// so the user can connect several channels and pick which one each upload goes to.
//
// Account shape:
//   {
//     id: string            // YouTube channelId — unique key
//     channelTitle: string  // human-readable channel name
//     email?: string        // Google account email (best-effort)
//     tokens: { access_token, refresh_token, scope, token_type, expiry_date, ... }
//     addedAt: number
//   }
// File shape: { accounts: Account[], defaultId: string | null }

import * as fs from "fs";
import * as path from "path";
import { google } from "googleapis";

const ACCOUNTS_PATH = path.join(process.cwd(), "data", "youtube-accounts.json");
const LEGACY_TOKENS_PATH = path.join(process.cwd(), "data", "youtube-tokens.json");

export interface YtAccount {
  id: string;
  channelTitle: string;
  email?: string;
  tokens: any;
  addedAt: number;
}

interface AccountsFile {
  accounts: YtAccount[];
  defaultId: string | null;
}

function emptyFile(): AccountsFile {
  return { accounts: [], defaultId: null };
}

export function loadAccountsFile(): AccountsFile {
  try {
    if (fs.existsSync(ACCOUNTS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf8"));
      if (parsed && Array.isArray(parsed.accounts)) {
        return { accounts: parsed.accounts, defaultId: parsed.defaultId || null };
      }
    }
  } catch {}
  return emptyFile();
}

export function saveAccountsFile(file: AccountsFile): void {
  fs.mkdirSync(path.dirname(ACCOUNTS_PATH), { recursive: true });
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(file, null, 2), "utf8");
}

// Build an OAuth2 client for token operations (no redirect URI needed here).
function buildOAuthClient(): any {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID || "",
    process.env.YOUTUBE_CLIENT_SECRET || ""
  );
}

// Fetch the authenticated user's channel info using a token set.
// Returns { channelId, channelTitle, email? } or null on failure.
export async function fetchChannelInfo(tokens: any): Promise<{ channelId: string; channelTitle: string; email?: string } | null> {
  try {
    const client = buildOAuthClient();
    client.setCredentials(tokens);
    const youtube = google.youtube({ version: "v3", auth: client });
    const res = await youtube.channels.list({ part: ["snippet"], mine: true });
    const item = res.data.items?.[0];
    if (!item?.id) return null;
    return {
      channelId: item.id,
      channelTitle: item.snippet?.title || "YouTube Channel",
      email: (item.snippet as any)?.email || undefined
    };
  } catch (e: any) {
    console.log("[YT-ACCOUNTS] fetchChannelInfo failed:", e.message?.slice(0, 120));
    return null;
  }
}

// Migrate the legacy single-token file into the accounts list (one-time).
// Called lazily before reads/writes so an existing single-channel setup keeps working.
export async function ensureMigrated(): Promise<void> {
  try {
    if (fs.existsSync(ACCOUNTS_PATH)) return; // already migrated / in use
    if (!fs.existsSync(LEGACY_TOKENS_PATH)) return; // nothing to migrate

    const legacy = JSON.parse(fs.readFileSync(LEGACY_TOKENS_PATH, "utf8"));
    if (!legacy?.access_token && !legacy?.refresh_token) return;

    // Only migrate if we can identify the channel. Old tokens that lack the
    // youtube.readonly scope cannot report their channel, so we skip migration
    // for those and let the legacy token keep working as the upload fallback.
    // The user can reconnect once (with the new scope) to get a named account.
    const info = await fetchChannelInfo(legacy);
    if (!info?.channelId) {
      console.log("[YT-ACCOUNTS] Legacy token lacks channel-read scope — skipping migration (legacy token still usable for uploads). Reconnect the channel to name it.");
      // Write an empty accounts file so we don't retry migration on every call.
      saveAccountsFile(emptyFile());
      return;
    }

    const id = info.channelId;
    const account: YtAccount = {
      id,
      channelTitle: info.channelTitle || "YouTube Channel",
      email: info.email,
      tokens: legacy,
      addedAt: Date.now()
    };
    saveAccountsFile({ accounts: [account], defaultId: id });
    console.log(`[YT-ACCOUNTS] Migrated legacy token -> account "${account.channelTitle}" (${id})`);
  } catch (e: any) {
    console.log("[YT-ACCOUNTS] Migration error:", e.message?.slice(0, 120));
  }
}

// List accounts (public shape — never exposes tokens).
export async function listAccounts(): Promise<{ id: string; channelTitle: string; email?: string; isDefault: boolean }[]> {
  await ensureMigrated();
  const file = loadAccountsFile();
  return file.accounts.map(a => ({
    id: a.id,
    channelTitle: a.channelTitle,
    email: a.email,
    isDefault: file.defaultId === a.id
  }));
}

export async function getAccount(id: string): Promise<YtAccount | null> {
  await ensureMigrated();
  const file = loadAccountsFile();
  return file.accounts.find(a => a.id === id) || null;
}

export async function getDefaultAccount(): Promise<YtAccount | null> {
  await ensureMigrated();
  const file = loadAccountsFile();
  if (file.defaultId) {
    const def = file.accounts.find(a => a.id === file.defaultId);
    if (def) return def;
  }
  return file.accounts[0] || null;
}

// Add or update an account from a fresh OAuth token set.
// Fetches channel info to key the account, then upserts.
export async function upsertAccountFromTokens(tokens: any): Promise<YtAccount> {
  await ensureMigrated();
  const info = await fetchChannelInfo(tokens);
  const id = info?.channelId || `unknown-${Date.now()}`;
  const file = loadAccountsFile();
  const existing = file.accounts.find(a => a.id === id);
  if (existing) {
    existing.tokens = tokens;
    existing.channelTitle = info?.channelTitle || existing.channelTitle;
    existing.email = info?.email || existing.email;
  } else {
    file.accounts.push({
      id,
      channelTitle: info?.channelTitle || "YouTube Channel",
      email: info?.email,
      tokens,
      addedAt: Date.now()
    });
  }
  if (!file.defaultId) file.defaultId = id;
  saveAccountsFile(file);
  const saved = file.accounts.find(a => a.id === id)!;
  console.log(`[YT-ACCOUNTS] Upserted account "${saved.channelTitle}" (${id}) — total ${file.accounts.length}`);
  return saved;
}

export async function removeAccount(id: string): Promise<boolean> {
  await ensureMigrated();
  const file = loadAccountsFile();
  const before = file.accounts.length;
  file.accounts = file.accounts.filter(a => a.id !== id);
  if (file.defaultId === id) file.defaultId = file.accounts[0]?.id || null;
  saveAccountsFile(file);
  return file.accounts.length < before;
}

export async function setDefaultAccount(id: string): Promise<boolean> {
  await ensureMigrated();
  const file = loadAccountsFile();
  if (!file.accounts.some(a => a.id === id)) return false;
  file.defaultId = id;
  saveAccountsFile(file);
  return true;
}

// Refresh an account's expired access token using its refresh_token.
// Returns true on success (tokens updated in place + persisted).
export async function refreshAccountToken(account: YtAccount): Promise<boolean> {
  try {
    if (!account.tokens?.refresh_token) return false;
    const clientId = process.env.YOUTUBE_CLIENT_ID || "";
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || "";
    if (!clientId || !clientSecret) return false;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: account.tokens.refresh_token,
        grant_type: "refresh_token"
      })
    });
    if (!res.ok) {
      console.log(`[YT-ACCOUNTS] Refresh failed for ${account.id}: ${res.status}`);
      return false;
    }
    const newTokens = await res.json();
    account.tokens = { ...account.tokens, ...newTokens, refresh_token: newTokens.refresh_token || account.tokens.refresh_token };

    const file = loadAccountsFile();
    const stored = file.accounts.find(a => a.id === account.id);
    if (stored) {
      stored.tokens = account.tokens;
      saveAccountsFile(file);
    }
    console.log(`[YT-ACCOUNTS] Token refreshed for "${account.channelTitle}"`);
    return true;
  } catch (e: any) {
    console.log("[YT-ACCOUNTS] Refresh error:", e.message?.slice(0, 120));
    return false;
  }
}
