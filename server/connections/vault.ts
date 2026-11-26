export type Tokens = {
  accessToken: string;
  refreshToken?: string;
  accessExpiresAt: number | null;
  refreshExpiresAt?: number | null;
};
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
/** Use a 32-byte base64 secret from the deployment secret store, never the browser. */
export async function createTokenVault(base64Key: string) {
  const bytes = decode(base64Key);
  if (bytes.length !== 32)
    throw new Error("Token vault requires a 256-bit key");
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  const context = (workspaceId: string, connectionId: string) =>
    new TextEncoder().encode(JSON.stringify([workspaceId, connectionId]));
  return {
    async seal(tokens: Tokens, workspaceId: string, connectionId: string) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: context(workspaceId, connectionId),
        },
        key,
        new TextEncoder().encode(JSON.stringify(tokens)),
      );
      return JSON.stringify({
        v: 1,
        iv: encode(iv),
        data: encode(new Uint8Array(encrypted)),
      });
    },
    async open(
      value: string,
      workspaceId: string,
      connectionId: string,
    ): Promise<Tokens> {
      const envelope = JSON.parse(value);
      if (envelope.v !== 1) throw new Error("Unsupported token envelope");
      const plain = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decode(envelope.iv),
          additionalData: context(workspaceId, connectionId),
        },
        key,
        decode(envelope.data),
      );
      const tokens = JSON.parse(new TextDecoder().decode(plain));
      if (
        typeof tokens.accessToken !== "string" ||
        !tokens.accessToken ||
        !(
          tokens.accessExpiresAt === null ||
          Number.isFinite(tokens.accessExpiresAt)
        ) ||
        (tokens.refreshToken !== undefined &&
          typeof tokens.refreshToken !== "string")
      )
        throw new Error("Invalid token envelope");
      return tokens;
    },
  };
}
