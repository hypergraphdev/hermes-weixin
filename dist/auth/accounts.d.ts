export declare const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export declare const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
export declare function listIndexedAccountIds(): string[];
export declare function registerAccountId(accountId: string): void;
export declare function unregisterAccountId(accountId: string): void;
export type AccountData = {
    token?: string;
    savedAt?: string;
    baseUrl?: string;
    userId?: string;
};
export declare function loadAccount(accountId: string): AccountData | null;
export declare function saveAccount(accountId: string, update: {
    token?: string;
    baseUrl?: string;
    userId?: string;
}): void;
export declare function clearAccount(accountId: string): void;
export declare function clearStaleAccountsForUserId(currentAccountId: string, userId: string, onClearContextTokens?: (accountId: string) => void): void;
export type ResolvedAccount = {
    accountId: string;
    baseUrl: string;
    cdnBaseUrl: string;
    token?: string;
    enabled: boolean;
    configured: boolean;
    name?: string;
};
export declare function resolveAccount(accountId: string): ResolvedAccount;
/** Normalize raw account IDs to filesystem-safe format. */
export declare function normalizeAccountId(raw: string): string;
//# sourceMappingURL=accounts.d.ts.map