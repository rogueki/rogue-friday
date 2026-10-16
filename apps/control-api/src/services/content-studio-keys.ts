import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ContentStudioKeys } from "@friday/sdk";
import { kvGet, kvSet, type Db } from "../db/database";

export type StudioProvider = keyof ContentStudioKeys;
const PROVIDERS = ["kie", "elevenlabs", "capcut"] as const;
const ENV_NAME: Record<StudioProvider, string> = {
  kie: "KIE_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  capcut: "CAPCUT_API_KEY",
};
const PREFIX = "content-studio.secret.";
const VERSION = "v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

const rowName = (provider: StudioProvider) => `${PREFIX}${provider}`;
const aad = (provider: StudioProvider) => Buffer.from(`friday/content-studio/${VERSION}/${provider}`, "utf8");

/** Encrypted records require the original auth.key; a newly generated one cannot decrypt them. */
export class ContentStudioKeysService {
  static hasPersisted(db: Db): boolean {
    return PROVIDERS.some((provider) => kvGet(db, rowName(provider)) !== undefined);
  }

  constructor(private readonly db: Db, private readonly encryptionKey: Buffer, private readonly env: NodeJS.ProcessEnv) {
    if (encryptionKey.length !== 32) throw new Error("Content Studio encryption key is invalid");
    // Detect lost or replaced auth.key before serving requests or silently falling back to environment values.
    for (const provider of PROVIDERS) this.readStored(provider);
  }

  private readStored(provider: StudioProvider): string | undefined {
    const value = kvGet(this.db, rowName(provider));
    if (value === undefined) return undefined;
    const parts = value.split(":");
    if (parts.length !== 4 || parts[0] !== VERSION) throw new Error(`Content Studio encrypted key for ${provider} has an unsupported format`);
    try {
      const nonce = Buffer.from(parts[1]!, "base64");
      const tag = Buffer.from(parts[2]!, "base64");
      const ciphertext = Buffer.from(parts[3]!, "base64");
      if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) throw new Error("invalid envelope");
      const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, nonce);
      decipher.setAAD(aad(provider));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      if (!plaintext) throw new Error("empty secret");
      return plaintext;
    } catch {
      // Do not log ciphertext, plaintext, or the underlying crypto error.
      throw new Error(`Content Studio encrypted key for ${provider} cannot be decrypted; restore the original auth.key`);
    }
  }

  status(): ContentStudioKeys {
    return {
      kie: Boolean(this.get("kie")),
      elevenlabs: Boolean(this.get("elevenlabs")),
      capcut: Boolean(this.get("capcut")),
    };
  }

  get(provider: StudioProvider): string | undefined {
    return this.readStored(provider) ?? this.env[ENV_NAME[provider]] ?? undefined;
  }

  set(provider: StudioProvider, key: string): void {
    if (!key) {
      this.db.prepare("DELETE FROM kv WHERE key = ?").run(rowName(provider));
      return;
    }
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, nonce);
    cipher.setAAD(aad(provider));
    const ciphertext = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
    const envelope = [VERSION, nonce.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
    kvSet(this.db, rowName(provider), envelope);
  }
}
