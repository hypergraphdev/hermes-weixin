export declare const DEFAULT_ILINK_BOT_TYPE = "3";
export type WeixinQrStartResult = {
    qrcodeUrl?: string;
    message: string;
    sessionKey: string;
};
export type WeixinQrWaitResult = {
    connected: boolean;
    botToken?: string;
    accountId?: string;
    baseUrl?: string;
    userId?: string;
    message: string;
};
export declare function startWeixinLoginWithQr(opts: {
    verbose?: boolean;
    force?: boolean;
    accountId?: string;
    apiBaseUrl: string;
    botType?: string;
}): Promise<WeixinQrStartResult>;
export declare function waitForWeixinLogin(opts: {
    timeoutMs?: number;
    verbose?: boolean;
    sessionKey: string;
    apiBaseUrl: string;
    botType?: string;
}): Promise<WeixinQrWaitResult>;
//# sourceMappingURL=login-qr.d.ts.map