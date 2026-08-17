import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";

// Hash the secret to ensure it is exactly 32 bytes (256 bits) for AES-256
const getSecretKey = (): Buffer => {
  const secret = process.env.ENCRYPTION_SECRET || "";
  if (!secret || secret === "replace-with-a-secure-32-character-random-string") {
    throw new Error("ENCRYPTION_SECRET must be configured with a secure random value.");
  }
  return crypto.createHash("sha256").update(secret).digest();
};

/**
 * Encrypt a plain-text API key securely
 */
export function encrypt(text: string): string {
  if (!text) return "";
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getSecretKey(), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt an encrypted API key safely
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return "";
  try {
    const parts = encryptedText.split(":");
    if (parts.length !== 2) return "";
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, getSecretKey(), iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (e) {
    console.error("Decryption failed:", e);
    return "";
  }
}
