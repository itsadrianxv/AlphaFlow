import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const PREFIX = "v1";

export function validateFeishuWebhook(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("FEISHU_WEBHOOK_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "open.feishu.cn" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !/^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+$/.test(url.pathname)
  )
    throw new Error("FEISHU_WEBHOOK_INVALID");
  return url.toString();
}

function encryptionKey(secret: string) {
  if (!secret.trim()) throw new Error("FEISHU_CREDENTIAL_KEY_MISSING");
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptFeishuWebhook(value: string, secret: string) {
  const webhook = validateFeishuWebhook(value);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(webhook, "utf8"),
    cipher.final(),
  ]);
  return [
    PREFIX,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptFeishuWebhook(value: string, secret: string) {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue || version !== PREFIX)
    throw new Error("FEISHU_CREDENTIAL_INVALID");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return validateFeishuWebhook(
      Buffer.concat([
        decipher.update(Buffer.from(ciphertextValue, "base64url")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new Error("FEISHU_CREDENTIAL_INVALID");
  }
}

export function maskFeishuWebhook(value: string) {
  const webhook = validateFeishuWebhook(value);
  const url = new URL(webhook);
  const token = url.pathname.split("/").at(-1) ?? "";
  return `${url.origin}/open-apis/bot/v2/hook/****${token.slice(-4)}`;
}
