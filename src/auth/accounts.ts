import fs from "node:fs";
import path from "node:path";

import { resolveStateDir } from "../storage/state-dir.js";
import { logger } from "../util/logger.js";

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

// ---------------------------------------------------------------------------
// Account index (persistent list of registered account IDs)
// ---------------------------------------------------------------------------

function resolveWeixinStateDir(): string {
  return resolveStateDir();
}

function resolveAccountIndexPath(): string {
  return path.join(resolveWeixinStateDir(), "accounts.json");
}

export function listIndexedAccountIds(): string[] {
  const filePath = resolveAccountIndexPath();
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.trim() !== "");
  } catch {
    return [];
  }
}

export function registerAccountId(accountId: string): void {
  const dir = resolveWeixinStateDir();
  fs.mkdirSync(dir, { recursive: true });
  const existing = listIndexedAccountIds();
  if (existing.includes(accountId)) return;
  const updated = [...existing, accountId];
  fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify(updated, null, 2), "utf-8");
}

export function unregisterAccountId(accountId: string): void {
  const existing = listIndexedAccountIds();
  const updated = existing.filter((id) => id !== accountId);
  if (updated.length !== existing.length) {
    fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify(updated, null, 2), "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Account store (per-account credential files)
// ---------------------------------------------------------------------------

export type AccountData = {
  token?: string;
  savedAt?: string;
  baseUrl?: string;
  userId?: string;
};

function resolveAccountsDir(): string {
  return path.join(resolveWeixinStateDir(), "accounts");
}

function resolveAccountPath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.json`);
}

export function loadAccount(accountId: string): AccountData | null {
  try {
    const filePath = resolveAccountPath(accountId);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as AccountData;
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveAccount(
  accountId: string,
  update: { token?: string; baseUrl?: string; userId?: string },
): void {
  const dir = resolveAccountsDir();
  fs.mkdirSync(dir, { recursive: true });

  const existing = loadAccount(accountId) ?? {};
  const token = update.token?.trim() || existing.token;
  const baseUrl = update.baseUrl?.trim() || existing.baseUrl;
  const userId = update.userId !== undefined
    ? update.userId.trim() || undefined
    : existing.userId?.trim() || undefined;

  const data: AccountData = {
    ...(token ? { token, savedAt: new Date().toISOString() } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(userId ? { userId } : {}),
  };

  const filePath = resolveAccountPath(accountId);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  try { fs.chmodSync(filePath, 0o600); } catch { /* best-effort */ }
}

export function clearAccount(accountId: string): void {
  const dir = resolveAccountsDir();
  const accountFiles = [
    `${accountId}.json`,
    `${accountId}.sync.json`,
    `${accountId}.context-tokens.json`,
  ];
  for (const file of accountFiles) {
    try { fs.unlinkSync(path.join(dir, file)); } catch { /* ignore */ }
  }
}

export function clearStaleAccountsForUserId(
  currentAccountId: string,
  userId: string,
  onClearContextTokens?: (accountId: string) => void,
): void {
  if (!userId) return;
  const allIds = listIndexedAccountIds();
  for (const id of allIds) {
    if (id === currentAccountId) continue;
    const data = loadAccount(id);
    if (data?.userId?.trim() === userId) {
      logger.info(`clearStaleAccountsForUserId: removing stale account=${id} (same userId=${userId})`);
      onClearContextTokens?.(id);
      clearAccount(id);
      unregisterAccountId(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Account resolution
// ---------------------------------------------------------------------------

export type ResolvedAccount = {
  accountId: string;
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
};

export function resolveAccount(accountId: string): ResolvedAccount {
  const data = loadAccount(accountId);
  const token = data?.token?.trim() || undefined;
  const stateBaseUrl = data?.baseUrl?.trim() || "";

  return {
    accountId,
    baseUrl: stateBaseUrl || DEFAULT_BASE_URL,
    cdnBaseUrl: CDN_BASE_URL,
    token,
    enabled: true,
    configured: Boolean(token),
    name: undefined,
  };
}

/** Normalize raw account IDs to filesystem-safe format. */
export function normalizeAccountId(raw: string): string {
  return raw.replace(/[@.]/g, "-");
}
