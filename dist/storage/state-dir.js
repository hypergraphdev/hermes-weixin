import os from "node:os";
import path from "node:path";
/** Resolve the weixin state directory (accounts, logs, sync buffers). */
export function resolveStateDir() {
    return (process.env.WEIXIN_DATA_DIR?.trim() ||
        process.env.ZYLOS_STATE_DIR?.trim() ||
        path.join(process.env.HERMES_HOME || os.homedir(), "components/weixin"));
}
/** Resolve the media storage directory. */
export function resolveMediaDir() {
    return (process.env.WEIXIN_MEDIA_DIR?.trim() ||
        path.join(process.env.HERMES_HOME || os.homedir(), "media/weixin"));
}
//# sourceMappingURL=state-dir.js.map