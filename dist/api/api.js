import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../util/logger.js";
import { redactBody, redactUrl } from "../util/redact.js";
function readPackageJson() {
    try {
        const dir = path.dirname(fileURLToPath(import.meta.url));
        const pkgPath = path.resolve(dir, "..", "..", "package.json");
        return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    }
    catch {
        return {};
    }
}
const pkg = readPackageJson();
const CHANNEL_VERSION = pkg.version ?? "unknown";
const ILINK_APP_ID = pkg.ilink_appid ?? "";
function buildClientVersion(version) {
    const parts = version.split(".").map((p) => parseInt(p, 10));
    const major = parts[0] ?? 0;
    const minor = parts[1] ?? 0;
    const patch = parts[2] ?? 0;
    return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}
const ILINK_APP_CLIENT_VERSION = buildClientVersion(pkg.version ?? "0.0.0");
export function buildBaseInfo() {
    return { channel_version: CHANNEL_VERSION };
}
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;
function ensureTrailingSlash(url) {
    return url.endsWith("/") ? url : `${url}/`;
}
function randomWechatUin() {
    const uint32 = crypto.randomBytes(4).readUInt32BE(0);
    return Buffer.from(String(uint32), "utf-8").toString("base64");
}
// Note: routeTag support removed for simplicity; can be added later if needed
function buildCommonHeaders() {
    return {
        "iLink-App-Id": ILINK_APP_ID,
        "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
    };
}
function buildHeaders(opts) {
    const headers = {
        "Content-Type": "application/json",
        AuthorizationType: "ilink_bot_token",
        "Content-Length": String(Buffer.byteLength(opts.body, "utf-8")),
        "X-WECHAT-UIN": randomWechatUin(),
        ...buildCommonHeaders(),
    };
    if (opts.token?.trim()) {
        headers.Authorization = `Bearer ${opts.token.trim()}`;
    }
    return headers;
}
export async function apiGetFetch(params) {
    const base = ensureTrailingSlash(params.baseUrl);
    const url = new URL(params.endpoint, base);
    const hdrs = buildCommonHeaders();
    logger.debug(`GET ${redactUrl(url.toString())}`);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
        const res = await fetch(url.toString(), {
            method: "GET",
            headers: hdrs,
            signal: controller.signal,
        });
        clearTimeout(t);
        const rawText = await res.text();
        logger.debug(`${params.label} status=${res.status} raw=${redactBody(rawText)}`);
        if (!res.ok) {
            throw new Error(`${params.label} ${res.status}: ${rawText}`);
        }
        return rawText;
    }
    catch (err) {
        clearTimeout(t);
        throw err;
    }
}
async function apiPostFetch(params) {
    const base = ensureTrailingSlash(params.baseUrl);
    const url = new URL(params.endpoint, base);
    const hdrs = buildHeaders({ token: params.token, body: params.body });
    logger.debug(`POST ${redactUrl(url.toString())} body=${redactBody(params.body)}`);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
        const res = await fetch(url.toString(), {
            method: "POST",
            headers: hdrs,
            body: params.body,
            signal: controller.signal,
        });
        clearTimeout(t);
        const rawText = await res.text();
        logger.debug(`${params.label} status=${res.status} raw=${redactBody(rawText)}`);
        if (!res.ok) {
            throw new Error(`${params.label} ${res.status}: ${rawText}`);
        }
        return rawText;
    }
    catch (err) {
        clearTimeout(t);
        throw err;
    }
}
export async function getUpdates(params) {
    const timeout = params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
    try {
        const rawText = await apiPostFetch({
            baseUrl: params.baseUrl,
            endpoint: "ilink/bot/getupdates",
            body: JSON.stringify({
                get_updates_buf: params.get_updates_buf ?? "",
                base_info: buildBaseInfo(),
            }),
            token: params.token,
            timeoutMs: timeout,
            label: "getUpdates",
        });
        return JSON.parse(rawText);
    }
    catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            logger.debug(`getUpdates: client-side timeout after ${timeout}ms, returning empty response`);
            return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf };
        }
        throw err;
    }
}
export async function getUploadUrl(params) {
    const rawText = await apiPostFetch({
        baseUrl: params.baseUrl,
        endpoint: "ilink/bot/getuploadurl",
        body: JSON.stringify({
            filekey: params.filekey,
            media_type: params.media_type,
            to_user_id: params.to_user_id,
            rawsize: params.rawsize,
            rawfilemd5: params.rawfilemd5,
            filesize: params.filesize,
            thumb_rawsize: params.thumb_rawsize,
            thumb_rawfilemd5: params.thumb_rawfilemd5,
            thumb_filesize: params.thumb_filesize,
            no_need_thumb: params.no_need_thumb,
            aeskey: params.aeskey,
            base_info: buildBaseInfo(),
        }),
        token: params.token,
        timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
        label: "getUploadUrl",
    });
    return JSON.parse(rawText);
}
export async function sendMessage(params) {
    await apiPostFetch({
        baseUrl: params.baseUrl,
        endpoint: "ilink/bot/sendmessage",
        body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
        token: params.token,
        timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
        label: "sendMessage",
    });
}
export async function getConfig(params) {
    const rawText = await apiPostFetch({
        baseUrl: params.baseUrl,
        endpoint: "ilink/bot/getconfig",
        body: JSON.stringify({
            ilink_user_id: params.ilinkUserId,
            context_token: params.contextToken,
            base_info: buildBaseInfo(),
        }),
        token: params.token,
        timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
        label: "getConfig",
    });
    return JSON.parse(rawText);
}
export async function sendTyping(params) {
    await apiPostFetch({
        baseUrl: params.baseUrl,
        endpoint: "ilink/bot/sendtyping",
        body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
        token: params.token,
        timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
        label: "sendTyping",
    });
}
//# sourceMappingURL=api.js.map