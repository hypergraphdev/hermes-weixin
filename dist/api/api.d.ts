import type { BaseInfo, GetUploadUrlReq, GetUploadUrlResp, GetUpdatesReq, GetUpdatesResp, SendMessageReq, SendTypingReq, GetConfigResp } from "./types.js";
export type WeixinApiOptions = {
    baseUrl: string;
    token?: string;
    timeoutMs?: number;
    longPollTimeoutMs?: number;
};
export declare function buildBaseInfo(): BaseInfo;
export declare function apiGetFetch(params: {
    baseUrl: string;
    endpoint: string;
    timeoutMs: number;
    label: string;
}): Promise<string>;
export declare function getUpdates(params: GetUpdatesReq & {
    baseUrl: string;
    token?: string;
    timeoutMs?: number;
}): Promise<GetUpdatesResp>;
export declare function getUploadUrl(params: GetUploadUrlReq & WeixinApiOptions): Promise<GetUploadUrlResp>;
export declare function sendMessage(params: WeixinApiOptions & {
    body: SendMessageReq;
}): Promise<void>;
export declare function getConfig(params: WeixinApiOptions & {
    ilinkUserId: string;
    contextToken?: string;
}): Promise<GetConfigResp>;
export declare function sendTyping(params: WeixinApiOptions & {
    body: SendTypingReq;
}): Promise<void>;
//# sourceMappingURL=api.d.ts.map