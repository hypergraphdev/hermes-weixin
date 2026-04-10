export declare function uploadBufferToCdn(params: {
    buf: Buffer;
    uploadFullUrl?: string;
    uploadParam?: string;
    filekey: string;
    cdnBaseUrl: string;
    label: string;
    aeskey: Buffer;
}): Promise<{
    downloadParam: string;
}>;
//# sourceMappingURL=cdn-upload.d.ts.map