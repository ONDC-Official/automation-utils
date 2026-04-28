export function decodeBase64(s: string): string {
    try {
        return Buffer.from(s, "base64").toString("utf-8");
    } catch {
        return "";
    }
}
