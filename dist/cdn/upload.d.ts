import type { WeixinApiOptions } from "../api/api.js";
export type UploadedFileInfo = {
    filekey: string;
    downloadEncryptedQueryParam: string;
    aeskey: string;
    fileSize: number;
    fileSizeCiphertext: number;
};
export declare function downloadRemoteImageToTemp(url: string, destDir: string): Promise<string>;
export declare function uploadFileToWeixin(params: {
    filePath: string;
    toUserId: string;
    opts: WeixinApiOptions;
    cdnBaseUrl: string;
}): Promise<UploadedFileInfo>;
export declare function uploadVideoToWeixin(params: {
    filePath: string;
    toUserId: string;
    opts: WeixinApiOptions;
    cdnBaseUrl: string;
}): Promise<UploadedFileInfo>;
export declare function uploadFileAttachmentToWeixin(params: {
    filePath: string;
    fileName: string;
    toUserId: string;
    opts: WeixinApiOptions;
    cdnBaseUrl: string;
}): Promise<UploadedFileInfo>;
//# sourceMappingURL=upload.d.ts.map