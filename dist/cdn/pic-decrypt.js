import { decryptAesEcb } from "./aes-ecb.js";
import { buildCdnDownloadUrl, ENABLE_CDN_URL_FALLBACK } from "./cdn-url.js";
import { logger } from "../util/logger.js";
async function fetchCdnBytes(url, label) {
    let res;
    try {
        res = await fetch(url);
    }
    catch (err) {
        const cause = err.cause ?? err.code ?? "(no cause)";
        logger.error(`${label}: fetch network error url=${url} err=${String(err)} cause=${String(cause)}`);
        throw err;
    }
    logger.debug(`${label}: response status=${res.status} ok=${res.ok}`);
    if (!res.ok) {
        const body = await res.text().catch(() => "(unreadable)");
        const msg = `${label}: CDN download ${res.status} ${res.statusText} body=${body}`;
        logger.error(msg);
        throw new Error(msg);
    }
    return Buffer.from(await res.arrayBuffer());
}
function parseAesKey(aesKeyBase64, label) {
    const decoded = Buffer.from(aesKeyBase64, "base64");
    if (decoded.length === 16)
        return decoded;
    if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
        return Buffer.from(decoded.toString("ascii"), "hex");
    }
    const msg = `${label}: aes_key must decode to 16 raw bytes or 32-char hex string, got ${decoded.length} bytes`;
    logger.error(msg);
    throw new Error(msg);
}
export async function downloadAndDecryptBuffer(encryptedQueryParam, aesKeyBase64, cdnBaseUrl, label, fullUrl) {
    const key = parseAesKey(aesKeyBase64, label);
    let url;
    if (fullUrl) {
        url = fullUrl;
    }
    else if (ENABLE_CDN_URL_FALLBACK) {
        url = buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);
    }
    else {
        throw new Error(`${label}: fullUrl is required (CDN URL fallback is disabled)`);
    }
    logger.debug(`${label}: fetching url=${url}`);
    const encrypted = await fetchCdnBytes(url, label);
    logger.debug(`${label}: downloaded ${encrypted.byteLength} bytes, decrypting`);
    const decrypted = decryptAesEcb(encrypted, key);
    logger.debug(`${label}: decrypted ${decrypted.length} bytes`);
    return decrypted;
}
export async function downloadPlainCdnBuffer(encryptedQueryParam, cdnBaseUrl, label, fullUrl) {
    let url;
    if (fullUrl) {
        url = fullUrl;
    }
    else if (ENABLE_CDN_URL_FALLBACK) {
        url = buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);
    }
    else {
        throw new Error(`${label}: fullUrl is required (CDN URL fallback is disabled)`);
    }
    logger.debug(`${label}: fetching url=${url}`);
    return fetchCdnBytes(url, label);
}
//# sourceMappingURL=pic-decrypt.js.map