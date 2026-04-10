import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { logger } from "../util/logger.js";
import { getMimeFromFilename, getExtensionFromMime } from "./mime.js";
import { downloadAndDecryptBuffer, downloadPlainCdnBuffer } from "../cdn/pic-decrypt.js";
import { silkToWav } from "./silk-transcode.js";
import type { MessageItem } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { tempFileName } from "../util/random.js";

const WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

const HOME = process.env.HERMES_HOME || process.env.HOME || os.homedir();
const MEDIA_INBOUND_DIR = process.env.WEIXIN_MEDIA_DIR
  ? path.join(process.env.WEIXIN_MEDIA_DIR, "inbound")
  : path.join(HOME, "media/weixin/inbound");

export type MediaDownloadResult = {
  decryptedPicPath?: string;
  decryptedVoicePath?: string;
  voiceMediaType?: string;
  decryptedFilePath?: string;
  fileMediaType?: string;
  decryptedVideoPath?: string;
};

/** Save buffer to local media directory and return the path. */
async function saveMediaBuffer(
  buf: Buffer,
  contentType?: string,
  originalFilename?: string,
): Promise<{ path: string }> {
  if (buf.length > WEIXIN_MEDIA_MAX_BYTES) {
    throw new Error(`Media too large: ${buf.length} bytes (max ${WEIXIN_MEDIA_MAX_BYTES})`);
  }
  await fs.mkdir(MEDIA_INBOUND_DIR, { recursive: true });
  let ext = ".bin";
  if (originalFilename) {
    ext = path.extname(originalFilename) || ext;
  } else if (contentType) {
    ext = getExtensionFromMime(contentType);
  }
  const filename = tempFileName("weixin", ext);
  const filePath = path.join(MEDIA_INBOUND_DIR, filename);
  await fs.writeFile(filePath, buf);
  return { path: filePath };
}

export async function downloadMediaFromItem(
  item: MessageItem,
  deps: {
    cdnBaseUrl: string;
    log: (msg: string) => void;
    errLog: (msg: string) => void;
    label: string;
  },
): Promise<MediaDownloadResult> {
  const { cdnBaseUrl, errLog, label } = deps;
  const result: MediaDownloadResult = {};

  if (item.type === MessageItemType.IMAGE) {
    const img = item.image_item;
    if (!img?.media?.encrypt_query_param && !img?.media?.full_url) return result;
    const aesKeyBase64 = img.aeskey
      ? Buffer.from(img.aeskey, "hex").toString("base64")
      : img.media!.aes_key;
    try {
      const buf = aesKeyBase64
        ? await downloadAndDecryptBuffer(
            img.media!.encrypt_query_param ?? "",
            aesKeyBase64,
            cdnBaseUrl,
            `${label} image`,
            img.media!.full_url,
          )
        : await downloadPlainCdnBuffer(
            img.media!.encrypt_query_param ?? "",
            cdnBaseUrl,
            `${label} image-plain`,
            img.media!.full_url,
          );
      const saved = await saveMediaBuffer(buf);
      result.decryptedPicPath = saved.path;
    } catch (err) {
      logger.error(`${label} image download/decrypt failed: ${String(err)}`);
      errLog(`weixin ${label} image download/decrypt failed: ${String(err)}`);
    }
  } else if (item.type === MessageItemType.VOICE) {
    const voice = item.voice_item;
    if ((!voice?.media?.encrypt_query_param && !voice?.media?.full_url) || !voice?.media?.aes_key) return result;
    try {
      const silkBuf = await downloadAndDecryptBuffer(
        voice.media!.encrypt_query_param ?? "",
        voice.media!.aes_key!,
        cdnBaseUrl,
        `${label} voice`,
        voice.media!.full_url,
      );
      const wavBuf = await silkToWav(silkBuf);
      if (wavBuf) {
        const saved = await saveMediaBuffer(wavBuf, "audio/wav");
        result.decryptedVoicePath = saved.path;
        result.voiceMediaType = "audio/wav";
      } else {
        const saved = await saveMediaBuffer(silkBuf, "audio/silk");
        result.decryptedVoicePath = saved.path;
        result.voiceMediaType = "audio/silk";
      }
    } catch (err) {
      logger.error(`${label} voice download/transcode failed: ${String(err)}`);
      errLog(`weixin ${label} voice download/transcode failed: ${String(err)}`);
    }
  } else if (item.type === MessageItemType.FILE) {
    const fileItem = item.file_item;
    if ((!fileItem?.media?.encrypt_query_param && !fileItem?.media?.full_url) || !fileItem?.media?.aes_key) return result;
    try {
      const buf = await downloadAndDecryptBuffer(
        fileItem.media!.encrypt_query_param ?? "",
        fileItem.media!.aes_key!,
        cdnBaseUrl,
        `${label} file`,
        fileItem.media!.full_url,
      );
      const mime = getMimeFromFilename(fileItem.file_name ?? "file.bin");
      const saved = await saveMediaBuffer(buf, mime, fileItem.file_name ?? undefined);
      result.decryptedFilePath = saved.path;
      result.fileMediaType = mime;
    } catch (err) {
      logger.error(`${label} file download failed: ${String(err)}`);
      errLog(`weixin ${label} file download failed: ${String(err)}`);
    }
  } else if (item.type === MessageItemType.VIDEO) {
    const videoItem = item.video_item;
    if ((!videoItem?.media?.encrypt_query_param && !videoItem?.media?.full_url) || !videoItem?.media?.aes_key) return result;
    try {
      const buf = await downloadAndDecryptBuffer(
        videoItem.media!.encrypt_query_param ?? "",
        videoItem.media!.aes_key!,
        cdnBaseUrl,
        `${label} video`,
        videoItem.media!.full_url,
      );
      const saved = await saveMediaBuffer(buf, "video/mp4");
      result.decryptedVideoPath = saved.path;
    } catch (err) {
      logger.error(`${label} video download failed: ${String(err)}`);
      errLog(`weixin ${label} video download failed: ${String(err)}`);
    }
  }

  return result;
}
