declare module "qrcode-terminal" {
  const qrcode: {
    generate(text: string, opts?: { small?: boolean }, cb?: (qr: string) => void): void;
  };
  export default qrcode;
}

declare module "silk-wasm" {
  export function decode(
    data: Buffer | Uint8Array,
    sampleRate: number,
  ): Promise<{ data: Uint8Array; duration: number }>;
}
