/**
 * Generate a prefixed unique ID using timestamp + crypto random bytes.
 * Format: `{prefix}:{timestamp}-{8-char hex}`
 */
export declare function generateId(prefix: string): string;
/**
 * Generate a temporary file name with random suffix.
 * Format: `{prefix}-{timestamp}-{8-char hex}{ext}`
 */
export declare function tempFileName(prefix: string, ext: string): string;
//# sourceMappingURL=random.d.ts.map