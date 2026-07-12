import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const VERSION = 1;

function deriveKey(secret) {
  if (!secret || secret.length < 16) {
    throw new Error("WTS_QUEUE_KEY must contain at least 16 characters.");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

function encryptJson(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    version: VERSION,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: ciphertext.toString("base64")
  });
}

function decryptJson(text, secret) {
  const envelope = JSON.parse(text);
  if (envelope.version !== VERSION) throw new Error("Unsupported queue format.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

export class EncryptedQueue {
  constructor(filePath, secret) {
    this.filePath = filePath;
    this.secret = secret;
    this.items = [];
  }

  async load() {
    try {
      const text = await readFile(this.filePath, "utf8");
      const value = decryptJson(text, this.secret);
      this.items = Array.isArray(value) ? value : [];
    } catch (error) {
      if (error?.code === "ENOENT") {
        this.items = [];
        return;
      }
      throw new Error(`Unable to read encrypted queue: ${error.message}`);
    }
  }

  async persist() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, encryptJson(this.items, this.secret), {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.filePath);
  }

  async add(item) {
    if (!item?.clientEventId) throw new Error("Queued scan requires clientEventId.");
    if (!this.items.some((existing) => existing.clientEventId === item.clientEventId)) {
      this.items.push(item);
      await this.persist();
    }
    return this.items.length;
  }

  peek() {
    return this.items[0] || null;
  }

  async remove(clientEventId) {
    this.items = this.items.filter((item) => item.clientEventId !== clientEventId);
    await this.persist();
    return this.items.length;
  }

  size() {
    return this.items.length;
  }
}
