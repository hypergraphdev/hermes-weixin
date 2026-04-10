/**
 * CLI outbound script for hermes-weixin.
 * Can be called standalone or by the HTTP bridge server.
 *
 * Usage: node dist/scripts/send.js --channel weixin --endpoint <user_id> --content <text>
 */
import path from "node:path";
import { listIndexedAccountIds, resolveAccount, } from "../auth/accounts.js";
import { getContextToken } from "../bot.js";
import { sendMessageWeixin, markdownToPlainText } from "../messaging/send.js";
import { sendWeixinMediaFile } from "../messaging/send-media.js";
import { logger } from "../util/logger.js";
// ─── Parse CLI args ─────────────────────────────────────────
function parseArgs() {
    const args = process.argv.slice(2);
    const result = {};
    let json = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--json") {
            json = true;
            continue;
        }
        if (args[i].startsWith("--") && i + 1 < args.length) {
            result[args[i].slice(2)] = args[i + 1];
            i++;
        }
    }
    return {
        channel: result.channel ?? "weixin",
        endpoint: result.endpoint ?? "",
        content: result.content ?? "",
        json,
    };
}
// ─── Endpoint parsing ───────────────────────────────────────
function parseEndpoint(endpoint) {
    // Format: "account:<name>|<user_id>" or bare "<user_id>"
    if (endpoint.startsWith("account:")) {
        const rest = endpoint.slice("account:".length);
        const pipeIdx = rest.indexOf("|");
        if (pipeIdx !== -1) {
            return {
                accountId: rest.slice(0, pipeIdx),
                target: rest.slice(pipeIdx + 1),
            };
        }
    }
    return { target: endpoint };
}
// ─── MEDIA: extraction ──────────────────────────────────────
function extractMedia(content) {
    // Look for MEDIA:/path/to/file on its own line
    const mediaMatch = content.match(/^MEDIA:(.+)$/m);
    if (mediaMatch) {
        const mediaPath = mediaMatch[1].trim();
        const text = content.replace(/^MEDIA:.+$/m, "").trim();
        return { text, mediaPath };
    }
    return { text: content };
}
// ─── Main ───────────────────────────────────────────────────
async function main() {
    const { endpoint, content } = parseArgs();
    if (!endpoint || !content) {
        console.error("Usage: send.js --channel weixin --endpoint <user_id> --content <text>");
        process.exit(1);
    }
    const { accountId: parsedAccountId, target } = parseEndpoint(endpoint);
    // Resolve account
    let accountId = parsedAccountId;
    if (!accountId) {
        const allIds = listIndexedAccountIds();
        if (allIds.length === 0) {
            console.error("[hermes-weixin] No accounts registered. Run login first.");
            process.exit(1);
        }
        accountId = allIds[0];
    }
    const account = resolveAccount(accountId);
    if (!account.configured) {
        console.error(`[hermes-weixin] Account ${accountId} not configured (no token).`);
        process.exit(1);
    }
    // Filter [SKIP] responses
    if (content.trim() === "[SKIP]" || content.trim().startsWith("[SKIP]")) {
        logger.debug(`send: skipping [SKIP] response for ${target}`);
        return;
    }
    const { text: rawText, mediaPath } = extractMedia(content);
    const text = markdownToPlainText(rawText);
    const contextToken = getContextToken(accountId, target);
    if (mediaPath) {
        logger.info(`send: sending media ${mediaPath} to=${target}`);
        await sendWeixinMediaFile({
            filePath: path.isAbsolute(mediaPath) ? mediaPath : path.resolve(mediaPath),
            to: target,
            text,
            opts: { baseUrl: account.baseUrl, token: account.token, contextToken },
            cdnBaseUrl: account.cdnBaseUrl,
        });
    }
    else {
        logger.info(`send: sending text to=${target} textLen=${text.length}`);
        await sendMessageWeixin({
            to: target,
            text,
            opts: { baseUrl: account.baseUrl, token: account.token, contextToken },
        });
    }
    console.log(`[hermes-weixin] Message sent to ${target}`);
}
main().catch((err) => {
    console.error(`[hermes-weixin] Send failed: ${String(err)}`);
    process.exit(1);
});
//# sourceMappingURL=send.js.map