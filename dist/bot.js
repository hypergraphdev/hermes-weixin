/**
 * hermes-weixin — WeChat messaging bridge for Hermes Agent
 * QR-code login + long-poll getUpdates + HTTP bridge to Hermes Gateway.
 *
 * Based on zylos-weixin, adapted for Hermes Agent architecture.
 * Instead of C4 comm-bridge, uses HTTP to communicate with Hermes Gateway.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { getUpdates, getConfig, sendTyping } from "./api/api.js";
import { MessageItemType, TypingStatus } from "./api/types.js";
import { listIndexedAccountIds, registerAccountId, normalizeAccountId, saveAccount, resolveAccount, clearStaleAccountsForUserId, DEFAULT_BASE_URL, } from "./auth/accounts.js";
import { DEFAULT_ILINK_BOT_TYPE, startWeixinLoginWithQr, waitForWeixinLogin, } from "./auth/login-qr.js";
import { downloadMediaFromItem } from "./media/media-download.js";
import { sendMessageWeixin, markdownToPlainText } from "./messaging/send.js";
import { sendWeixinMediaFile } from "./messaging/send-media.js";
import { getSyncBufFilePath, loadGetUpdatesBuf, saveGetUpdatesBuf } from "./storage/sync-buf.js";
import { logger } from "./util/logger.js";
// ─── Constants ──────────────────────────────────────────────
const HOME = process.env.HERMES_HOME || process.env.HOME || os.homedir();
const HERMES_GATEWAY_URL = process.env.HERMES_GATEWAY_URL || "http://localhost:8080";
const BRIDGE_PORT = parseInt(process.env.WEIXIN_BRIDGE_PORT || "9100", 10);
const CHANNEL = "weixin";
const LOG_PREFIX = "[hermes-weixin]";
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
const SESSION_EXPIRED_ERRCODE = -14;
const MAX_CONCURRENT_DISPATCHES = 10;
let _activeDispatches = 0;
// ─── Message deduplication ──────────────────────────────────
const DEDUP_WINDOW_MS = 30_000;
const _recentMessages = new Map();
function isDuplicate(fromUserId, text) {
    const key = `${fromUserId}:${text}`;
    const now = Date.now();
    const lastSeen = _recentMessages.get(key);
    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS)
        return true;
    _recentMessages.set(key, now);
    if (_recentMessages.size > 200) {
        for (const [k, t] of _recentMessages) {
            if (now - t > DEDUP_WINDOW_MS)
                _recentMessages.delete(k);
        }
    }
    return false;
}
// ─── Hermes Gateway Bridge ─────────────────────────────────
function buildEndpoint(accountId, target) {
    const allIds = listIndexedAccountIds();
    if (allIds.length <= 1)
        return target;
    return `account:${accountId}|${target}`;
}
/**
 * Send an inbound WeChat message to Hermes Gateway via HTTP webhook.
 * Hermes Gateway receives this and routes it to the AI agent.
 */
async function sendToHermes(endpoint, content) {
    if (!content)
        return;
    if (_activeDispatches >= MAX_CONCURRENT_DISPATCHES) {
        console.warn(`${LOG_PREFIX} Dispatch concurrency cap reached (${MAX_CONCURRENT_DISPATCHES}), dropping`);
        return;
    }
    _activeDispatches++;
    try {
        const body = JSON.stringify({ from: endpoint, content, channel: CHANNEL });
        const url = new URL("/api/webhook/weixin", HERMES_GATEWAY_URL);
        const resp = await fetch(url.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: AbortSignal.timeout(15_000),
        });
        if (resp.ok) {
            console.log(`${LOG_PREFIX} -> Hermes: ${content.substring(0, 80)}...`);
        }
        else {
            const text = await resp.text().catch(() => "");
            console.error(`${LOG_PREFIX} Hermes returned ${resp.status}: ${text.substring(0, 200)}`);
        }
    }
    catch (err) {
        console.error(`${LOG_PREFIX} Hermes dispatch error: ${String(err)}`);
    }
    finally {
        _activeDispatches--;
    }
}
// ─── Message formatting ─────────────────────────────────────
function escapeXml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function extractTextBody(itemList) {
    if (!itemList?.length)
        return "";
    for (const item of itemList) {
        if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
            return String(item.text_item.text);
        }
        if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
            return item.voice_item.text;
        }
    }
    return "";
}
function formatInboundMessage(msg, accountId, mediaResult) {
    const sender = msg.from_user_id ?? "unknown";
    const text = extractTextBody(msg.item_list);
    const parts = [];
    parts.push(`[Weixin DM] ${escapeXml(sender)} said: ${escapeXml(text)}`);
    if (mediaResult.decryptedPicPath)
        parts.push(`\n[image: ${mediaResult.decryptedPicPath}]`);
    if (mediaResult.decryptedVideoPath)
        parts.push(`\n[video: ${mediaResult.decryptedVideoPath}]`);
    if (mediaResult.decryptedFilePath)
        parts.push(`\n[file: ${mediaResult.decryptedFilePath}]`);
    if (mediaResult.decryptedVoicePath)
        parts.push(`\n[voice: ${mediaResult.decryptedVoicePath}]`);
    return parts.join("");
}
// ─── Context token store ────────────────────────────────────
const contextTokenStore = new Map();
function contextTokenKey(accountId, userId) {
    return `${accountId}:${userId}`;
}
function setContextToken(accountId, userId, token) {
    contextTokenStore.set(contextTokenKey(accountId, userId), token);
    persistContextTokens(accountId);
}
export function getContextToken(accountId, userId) {
    return contextTokenStore.get(contextTokenKey(accountId, userId));
}
function persistContextTokens(accountId) {
    const prefix = `${accountId}:`;
    const tokens = {};
    for (const [k, v] of contextTokenStore) {
        if (k.startsWith(prefix))
            tokens[k.slice(prefix.length)] = v;
    }
    try {
        const { resolveStateDir } = await_import_stateDir();
        const dir = path.join(resolveStateDir(), "accounts");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${accountId}.context-tokens.json`), JSON.stringify(tokens, null, 0), "utf-8");
    }
    catch (err) {
        logger.warn(`persistContextTokens: failed: ${String(err)}`);
    }
}
function restoreContextTokens(accountId) {
    try {
        const { resolveStateDir } = await_import_stateDir();
        const filePath = path.join(resolveStateDir(), "accounts", `${accountId}.context-tokens.json`);
        if (!fs.existsSync(filePath))
            return;
        const raw = fs.readFileSync(filePath, "utf-8");
        const tokens = JSON.parse(raw);
        let count = 0;
        for (const [userId, token] of Object.entries(tokens)) {
            if (typeof token === "string" && token) {
                contextTokenStore.set(contextTokenKey(accountId, userId), token);
                count++;
            }
        }
        logger.info(`restoreContextTokens: restored ${count} tokens for account=${accountId}`);
    }
    catch (err) {
        logger.warn(`restoreContextTokens: failed: ${String(err)}`);
    }
}
// Lazy import to avoid circular dependency
function await_import_stateDir() {
    // state-dir is already imported at module scope in accounts.ts
    // This is a workaround for the context token persistence path
    const stateDir = process.env.WEIXIN_DATA_DIR?.trim() ||
        path.join(HOME, "components/weixin");
    return { resolveStateDir: () => stateDir };
}
// ─── HTTP Bridge Server (outbound: Hermes → WeChat) ────────
function startBridgeServer() {
    const server = http.createServer(async (req, res) => {
        if (req.method === "POST" && req.url === "/send") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { to, content, media_path, account_id } = data;
                    if (!to || !content) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "Missing 'to' or 'content'" }));
                        return;
                    }
                    // Filter [SKIP]
                    if (content.trim() === "[SKIP]" || content.trim().startsWith("[SKIP]")) {
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: true, skipped: true }));
                        return;
                    }
                    // Resolve account
                    let accountId = account_id;
                    if (!accountId) {
                        // Parse endpoint format: "account:<id>|<target>" or bare target
                        if (to.startsWith("account:")) {
                            const rest = to.slice("account:".length);
                            const pipe = rest.indexOf("|");
                            if (pipe !== -1)
                                accountId = rest.slice(0, pipe);
                        }
                    }
                    if (!accountId) {
                        const ids = listIndexedAccountIds();
                        if (ids.length === 0) {
                            res.writeHead(500, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "No WeChat accounts registered" }));
                            return;
                        }
                        accountId = ids[0];
                    }
                    const target = to.includes("|") ? to.split("|").pop() : to.replace(/^account:[^|]+\|?/, "");
                    const account = resolveAccount(accountId);
                    if (!account.configured) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: `Account ${accountId} not configured` }));
                        return;
                    }
                    const text = markdownToPlainText(content);
                    const contextToken = getContextToken(accountId, target);
                    if (media_path) {
                        await sendWeixinMediaFile({
                            filePath: path.isAbsolute(media_path) ? media_path : path.resolve(media_path),
                            to: target,
                            text,
                            opts: { baseUrl: account.baseUrl, token: account.token, contextToken },
                            cdnBaseUrl: account.cdnBaseUrl,
                        });
                    }
                    else {
                        await sendMessageWeixin({
                            to: target,
                            text,
                            opts: { baseUrl: account.baseUrl, token: account.token, contextToken },
                        });
                    }
                    console.log(`${LOG_PREFIX} Sent to WeChat: ${target} (${text.substring(0, 60)}...)`);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                }
                catch (err) {
                    console.error(`${LOG_PREFIX} Bridge send error: ${String(err)}`);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: String(err) }));
                }
            });
        }
        else if (req.method === "GET" && req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, accounts: listIndexedAccountIds().length }));
        }
        else {
            res.writeHead(404);
            res.end("Not found");
        }
    });
    server.listen(BRIDGE_PORT, "0.0.0.0", () => {
        console.log(`${LOG_PREFIX} Bridge server listening on port ${BRIDGE_PORT}`);
    });
}
// ─── Monitor loop ───────────────────────────────────────────
async function monitorAccount(account, abortSignal) {
    const { accountId, baseUrl, cdnBaseUrl, token } = account;
    const aLog = logger.withAccount(accountId);
    aLog.info(`Monitor started: baseUrl=${baseUrl}`);
    console.log(`${LOG_PREFIX} Monitor started for account=${accountId}`);
    restoreContextTokens(accountId);
    const syncFilePath = getSyncBufFilePath(accountId);
    const previousBuf = loadGetUpdatesBuf(syncFilePath);
    let getUpdatesBuf = previousBuf ?? "";
    if (previousBuf) {
        console.log(`${LOG_PREFIX} Resuming from previous sync buf (${getUpdatesBuf.length} bytes)`);
    }
    let nextTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS;
    let consecutiveFailures = 0;
    while (!abortSignal.aborted) {
        try {
            const resp = await getUpdates({
                baseUrl, token,
                get_updates_buf: getUpdatesBuf,
                timeoutMs: nextTimeoutMs,
            });
            if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
                nextTimeoutMs = resp.longpolling_timeout_ms;
            }
            const isApiError = (resp.ret !== undefined && resp.ret !== 0) ||
                (resp.errcode !== undefined && resp.errcode !== 0);
            if (isApiError) {
                const isSessionExpired = resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE;
                if (isSessionExpired) {
                    aLog.error(`Session expired (errcode ${SESSION_EXPIRED_ERRCODE}), pausing 5 min`);
                    console.error(`${LOG_PREFIX} Session expired for ${accountId}, pausing 5 min`);
                    consecutiveFailures = 0;
                    await sleep(5 * 60_000, abortSignal);
                    continue;
                }
                consecutiveFailures++;
                aLog.error(`getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg}`);
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    aLog.error(`${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off 30s`);
                    consecutiveFailures = 0;
                    await sleep(BACKOFF_DELAY_MS, abortSignal);
                }
                else {
                    await sleep(RETRY_DELAY_MS, abortSignal);
                }
                continue;
            }
            consecutiveFailures = 0;
            if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
                saveGetUpdatesBuf(syncFilePath, resp.get_updates_buf);
                getUpdatesBuf = resp.get_updates_buf;
            }
            const list = resp.msgs ?? [];
            for (const full of list) {
                const fromUserId = full.from_user_id ?? "";
                aLog.info(`inbound message: from=${fromUserId} types=${full.item_list?.map((i) => i.type).join(",") ?? "none"}`);
                // Download media
                const hasDownloadableMedia = (m) => m?.encrypt_query_param || m?.full_url;
                const mediaItem = full.item_list?.find((i) => i.type === MessageItemType.IMAGE && hasDownloadableMedia(i.image_item?.media)) ??
                    full.item_list?.find((i) => i.type === MessageItemType.VIDEO && hasDownloadableMedia(i.video_item?.media)) ??
                    full.item_list?.find((i) => i.type === MessageItemType.FILE && hasDownloadableMedia(i.file_item?.media)) ??
                    full.item_list?.find((i) => i.type === MessageItemType.VOICE && hasDownloadableMedia(i.voice_item?.media) && !i.voice_item?.text);
                let mediaResult = {};
                if (mediaItem) {
                    mediaResult = await downloadMediaFromItem(mediaItem, {
                        cdnBaseUrl,
                        log: (m) => aLog.info(m),
                        errLog: (m) => aLog.error(m),
                        label: "inbound",
                    });
                }
                // Store context token
                if (full.context_token) {
                    setContextToken(accountId, fromUserId, full.context_token);
                }
                // Send typing indicator (fire-and-forget)
                const contextToken = full.context_token || getContextToken(accountId, fromUserId);
                getConfig({ baseUrl, token, ilinkUserId: fromUserId, contextToken })
                    .then((cfg) => {
                    if (cfg.typing_ticket) {
                        return sendTyping({
                            baseUrl, token,
                            body: { ilink_user_id: fromUserId, typing_ticket: cfg.typing_ticket, status: TypingStatus.TYPING },
                        });
                    }
                })
                    .catch((err) => aLog.debug(`typing send skipped: ${String(err)}`));
                // Deduplicate
                const textBody = extractTextBody(full.item_list);
                if (isDuplicate(fromUserId, textBody)) {
                    aLog.info(`dedup: skipping duplicate from=${fromUserId} text=${textBody.substring(0, 40)}`);
                    continue;
                }
                // Format and dispatch to Hermes
                const formatted = formatInboundMessage(full, accountId, mediaResult);
                sendToHermes(buildEndpoint(accountId, fromUserId), formatted);
            }
        }
        catch (err) {
            if (abortSignal.aborted) {
                aLog.info("Monitor stopped (aborted)");
                return;
            }
            consecutiveFailures++;
            aLog.error(`getUpdates error: ${String(err)}`);
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                consecutiveFailures = 0;
                await sleep(BACKOFF_DELAY_MS, abortSignal);
            }
            else {
                await sleep(RETRY_DELAY_MS, abortSignal);
            }
        }
    }
    aLog.info("Monitor ended");
}
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
    });
}
// ─── Login flow ─────────────────────────────────────────────
async function loginAccount(accountId) {
    console.log("\n正在启动微信扫码登录...\n");
    const startResult = await startWeixinLoginWithQr({
        accountId,
        apiBaseUrl: DEFAULT_BASE_URL,
        botType: DEFAULT_ILINK_BOT_TYPE,
        verbose: true,
    });
    if (!startResult.qrcodeUrl) {
        console.error(`登录失败: ${startResult.message}`);
        return null;
    }
    console.log("\n使用微信扫描以下二维码，以完成连接：\n");
    try {
        const qrcodeterminal = await import("qrcode-terminal");
        await new Promise((resolve) => {
            qrcodeterminal.default.generate(startResult.qrcodeUrl, { small: true }, (qr) => {
                console.log(qr);
                console.log("如果二维码未能成功展示，请用浏览器打开以下链接扫码：");
                console.log(startResult.qrcodeUrl);
                resolve();
            });
        });
    }
    catch {
        console.log("二维码未加载成功，请用浏览器打开以下链接扫码：");
        console.log(startResult.qrcodeUrl);
    }
    console.log("\n等待连接结果...\n");
    const waitResult = await waitForWeixinLogin({
        sessionKey: startResult.sessionKey,
        apiBaseUrl: DEFAULT_BASE_URL,
        timeoutMs: 480_000,
        verbose: true,
    });
    if (waitResult.connected && waitResult.botToken && waitResult.accountId) {
        const normalizedId = normalizeAccountId(waitResult.accountId);
        saveAccount(normalizedId, {
            token: waitResult.botToken,
            baseUrl: waitResult.baseUrl,
            userId: waitResult.userId,
        });
        registerAccountId(normalizedId);
        if (waitResult.userId) {
            clearStaleAccountsForUserId(normalizedId, waitResult.userId);
        }
        console.log(`\n✅ 与微信连接成功！ accountId=${normalizedId}`);
        return resolveAccount(normalizedId);
    }
    else {
        console.error(`登录失败: ${waitResult.message}`);
        return null;
    }
}
// ─── Main ───────────────────────────────────────────────────
async function main() {
    console.log(`${LOG_PREFIX} Starting...`);
    console.log(`${LOG_PREFIX} Hermes Gateway: ${HERMES_GATEWAY_URL}`);
    console.log(`${LOG_PREFIX} Bridge port: ${BRIDGE_PORT}`);
    // Start HTTP bridge server for outbound messages (Hermes → WeChat)
    startBridgeServer();
    // Check if any accounts are registered
    let accountIds = listIndexedAccountIds();
    if (accountIds.length === 0) {
        console.log(`${LOG_PREFIX} No accounts found. Starting login flow...`);
        const account = await loginAccount();
        if (!account) {
            console.error(`${LOG_PREFIX} Login failed. Bridge server still running for future login.`);
            // Don't exit — keep bridge server running so Hermes can trigger login later
            return;
        }
        accountIds = listIndexedAccountIds();
    }
    // Start monitors for all registered accounts
    const controller = new AbortController();
    const shutdownHandler = () => {
        console.log(`\n${LOG_PREFIX} Shutting down...`);
        controller.abort();
        setTimeout(() => process.exit(0), 2000);
    };
    process.on("SIGINT", shutdownHandler);
    process.on("SIGTERM", shutdownHandler);
    console.log(`${LOG_PREFIX} Starting monitors for ${accountIds.length} account(s): ${accountIds.join(", ")}`);
    const monitors = accountIds.map((id) => {
        const account = resolveAccount(id);
        if (!account.configured) {
            console.warn(`${LOG_PREFIX} Account ${id} not configured (no token), skipping`);
            return Promise.resolve();
        }
        return monitorAccount(account, controller.signal).catch((err) => {
            console.error(`${LOG_PREFIX} Monitor for ${id} crashed: ${String(err)}`);
        });
    });
    await Promise.allSettled(monitors);
    console.log(`${LOG_PREFIX} All monitors stopped.`);
}
main().catch((err) => {
    console.error(`${LOG_PREFIX} Fatal error: ${String(err)}`);
    process.exit(1);
});
//# sourceMappingURL=bot.js.map