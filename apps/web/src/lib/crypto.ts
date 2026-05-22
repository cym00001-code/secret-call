import type {
  AttachmentKind,
  BurnAfterMs,
  CipherMessage,
  EncryptedAttachmentPayload,
  OfflineSecretKdfParams
} from "@/types/protocol";
import { maxAttachmentBytes } from "@/types/protocol";
import {
  base64UrlFromBytes,
  bytesFromBase64Url,
  bytesToHex,
  decodeUtf8,
  encodeFrame,
  encodeUtf8,
  toArrayBuffer
} from "./codec";

export const PBKDF2_ITERATIONS = 250_000;
export const OFFLINE_SECRET_KDF_PARAMS: OfflineSecretKdfParams = {
  version: 1,
  namespace: "offline-secret-v1",
  algorithm: "PBKDF2-SHA256-AES-GCM",
  iterations: PBKDF2_ITERATIONS
};

export interface RoomMaterial {
  roomIdHash: string;
  roomMessageKey: CryptoKey;
  securityCode: string;
}

export interface EncryptedOfflineSecret {
  ciphertext: string;
  iv: string;
  aad: string;
  salt: string;
  kdfParams: string;
}

export type DecryptedPayload =
  | { type: "text"; text: string }
  | {
      type: "attachment";
      kind: AttachmentKind;
      name: string;
      mimeType: string;
      size: number;
      bytes: Uint8Array;
    };

const subtle = () => {
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前浏览器不支持 Web Crypto");
  }
  return globalThis.crypto.subtle;
};

const normalize = (value: string) => value.trim().normalize("NFKC");

export const randomToken = (prefix: string) => {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${base64UrlFromBytes(bytes)}`;
};

const sha256 = (fields: Array<string | number>) => subtle().digest("SHA-256", toArrayBuffer(encodeFrame(fields)));

const groupedCode = (hex: string) =>
  hex
    .slice(0, 24)
    .toUpperCase()
    .match(/.{1,4}/gu)
    ?.join(" ") ?? "----";

export const deriveRoomMaterial = async (roomNumber: string, passphrase: string): Promise<RoomMaterial> => {
  const normalizedRoomNumber = normalize(roomNumber);
  const normalizedPassphrase = normalize(passphrase);
  const inputMaterial = `${normalizedRoomNumber}:${normalizedPassphrase}`;

  const passwordKey = await subtle().importKey(
    "raw",
    toArrayBuffer(encodeUtf8(inputMaterial)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const baseBits = await subtle().deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(encodeUtf8(`secret-room-v2:${normalizedRoomNumber}`)),
      iterations: PBKDF2_ITERATIONS
    },
    passwordKey,
    512
  );
  const baseMaterialHex = bytesToHex(baseBits);
  const roomIdMaterial = bytesToHex(await sha256(["room-id-material:v2", baseMaterialHex]));
  const roomIdHash = bytesToHex(await sha256(["room-id:v2", roomIdMaterial]));
  const messageKeyBytes = await sha256(["message-key:v2", baseMaterialHex]);
  const keyFingerprint = bytesToHex(await sha256(["message-key-fingerprint:v2", bytesToHex(messageKeyBytes)]));
  const securityCode = groupedCode(bytesToHex(await sha256(["security-code:v2", roomIdHash, keyFingerprint])));
  const roomMessageKey = await subtle().importKey(
    "raw",
    toArrayBuffer(messageKeyBytes),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  return {
    roomIdHash,
    roomMessageKey,
    securityCode
  };
};

export const aadForMessage = (
  roomIdHash: string,
  messageId: string,
  senderClientId: string,
  burnAfterMs: BurnAfterMs,
  createdAt: number
) => encodeFrame(["sr-aad-v2", roomIdHash, messageId, senderClientId, burnAfterMs, createdAt]);

export const encryptText = async (
  roomMessageKey: CryptoKey,
  roomIdHash: string,
  senderClientId: string,
  text: string,
  burnAfterMs: BurnAfterMs
): Promise<CipherMessage> => {
  return encryptPayload(roomMessageKey, roomIdHash, senderClientId, text, burnAfterMs);
};

export const encryptAttachment = async (
  roomMessageKey: CryptoKey,
  roomIdHash: string,
  senderClientId: string,
  file: {
    arrayBuffer: () => Promise<ArrayBuffer>;
    name: string;
    size: number;
    type: string;
  },
  burnAfterMs: BurnAfterMs
): Promise<CipherMessage> => {
  const kind: AttachmentKind = file.type.startsWith("video/") ? "video" : "image";
  const payload: EncryptedAttachmentPayload = {
    version: 1,
    type: "attachment",
    kind,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    data: base64UrlFromBytes(await file.arrayBuffer())
  };

  return encryptPayload(roomMessageKey, roomIdHash, senderClientId, JSON.stringify(payload), burnAfterMs);
};

const encryptPayload = async (
  roomMessageKey: CryptoKey,
  roomIdHash: string,
  senderClientId: string,
  plaintext: string,
  burnAfterMs: BurnAfterMs
): Promise<CipherMessage> => {
  const messageId = randomToken("msg");
  const createdAt = Date.now();
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const aad = aadForMessage(roomIdHash, messageId, senderClientId, burnAfterMs, createdAt);
  const ciphertext = await subtle().encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad)
    },
    roomMessageKey,
    toArrayBuffer(encodeUtf8(plaintext))
  );

  return {
    roomIdHash,
    messageId,
    senderClientId,
    iv: base64UrlFromBytes(iv),
    ciphertext: base64UrlFromBytes(ciphertext),
    aad: base64UrlFromBytes(aad),
    burnAfterMs,
    createdAt
  };
};

const isSafeAttachmentName = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 160;
const isSupportedAttachmentMime = (value: unknown, kind: AttachmentKind) =>
  typeof value === "string" &&
  value.length <= 120 &&
  (kind === "image" ? value.startsWith("image/") : value.startsWith("video/"));

const parseDecryptedPayload = (plaintext: string): DecryptedPayload => {
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (typeof parsed !== "object" || parsed === null) return { type: "text", text: plaintext };
    const payload = parsed as Partial<EncryptedAttachmentPayload>;
    if (payload.version !== 1 || payload.type !== "attachment") return { type: "text", text: plaintext };
    if (payload.kind !== "image" && payload.kind !== "video") throw new Error("Unsupported attachment kind");
    if (!isSafeAttachmentName(payload.name)) throw new Error("Invalid attachment name");
    if (!isSupportedAttachmentMime(payload.mimeType, payload.kind)) throw new Error("Unsupported attachment MIME type");
    if (typeof payload.size !== "number" || !Number.isFinite(payload.size) || payload.size <= 0) {
      throw new Error("Invalid attachment size");
    }
    if (payload.size > maxAttachmentBytes) throw new Error("Attachment too large");
    if (typeof payload.data !== "string" || payload.data.length === 0) throw new Error("Missing attachment data");
    const { kind, name, mimeType, size, data } = payload as EncryptedAttachmentPayload;
    const bytes = bytesFromBase64Url(data);
    if (bytes.byteLength !== size) throw new Error("Attachment size mismatch");

    return {
      type: "attachment",
      kind,
      name,
      mimeType,
      size,
      bytes
    };
  } catch (error) {
    if (error instanceof SyntaxError) return { type: "text", text: plaintext };
    throw error;
  }
};

export const decryptMessagePayload = async (
  roomMessageKey: CryptoKey,
  roomIdHash: string,
  message: CipherMessage
): Promise<DecryptedPayload> => {
  const expectedAad = aadForMessage(
    roomIdHash,
    message.messageId,
    message.senderClientId,
    message.burnAfterMs,
    message.createdAt
  );
  if (message.aad !== base64UrlFromBytes(expectedAad)) {
    throw new Error("AAD mismatch");
  }

  const plaintext = await subtle().decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(bytesFromBase64Url(message.iv)),
      additionalData: toArrayBuffer(expectedAad)
    },
    roomMessageKey,
    toArrayBuffer(bytesFromBase64Url(message.ciphertext))
  );

  return parseDecryptedPayload(decodeUtf8(plaintext));
};

export const decryptText = async (
  roomMessageKey: CryptoKey,
  roomIdHash: string,
  message: CipherMessage
): Promise<string> => {
  const payload = await decryptMessagePayload(roomMessageKey, roomIdHash, message);
  if (payload.type !== "text") throw new Error("Expected text payload");
  return payload.text;
};

const normalizePasscode = (value: string) => normalize(value);

const importPasscodeKey = (passcode: string) =>
  subtle().importKey("raw", toArrayBuffer(encodeUtf8(normalizePasscode(passcode))), "PBKDF2", false, ["deriveBits"]);

const deriveOfflineContentKeyBytes = async (passcode: string, salt: Uint8Array) => {
  const passwordKey = await importPasscodeKey(passcode);
  const bits = await subtle().deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(encodeFrame(["offline-secret-v1:salt", base64UrlFromBytes(salt)])),
      iterations: OFFLINE_SECRET_KDF_PARAMS.iterations
    },
    passwordKey,
    512
  );
  return sha256(["offline-secret-v1:content-key", bytesToHex(bits)]);
};

const importOfflineContentKey = async (passcode: string, salt: Uint8Array) =>
  subtle().importKey("raw", toArrayBuffer(await deriveOfflineContentKeyBytes(passcode, salt)), { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt"
  ]);

export const generateOfflinePasscode = () => {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (const byte of bytes) {
    result += alphabet[byte % alphabet.length];
  }
  return result.match(/.{1,4}/gu)?.join("-") ?? result;
};

export const encryptOfflineSecretText = async (text: string, passcode: string): Promise<EncryptedOfflineSecret> => {
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(salt);
  globalThis.crypto.getRandomValues(iv);
  const key = await importOfflineContentKey(passcode, salt);
  const aad = encodeFrame(["offline-secret-v1:aad", base64UrlFromBytes(salt), OFFLINE_SECRET_KDF_PARAMS.iterations]);
  const plaintext = encodeUtf8(JSON.stringify({ version: 1, type: "offline-secret-text", text }));
  const ciphertext = await subtle().encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad)
    },
    key,
    toArrayBuffer(plaintext)
  );

  return {
    ciphertext: base64UrlFromBytes(ciphertext),
    iv: base64UrlFromBytes(iv),
    aad: base64UrlFromBytes(aad),
    salt: base64UrlFromBytes(salt),
    kdfParams: base64UrlFromBytes(encodeUtf8(JSON.stringify(OFFLINE_SECRET_KDF_PARAMS)))
  };
};

export const decryptOfflineSecretText = async ({
  ciphertext,
  iv,
  aad,
  salt,
  passcode
}: {
  ciphertext: string;
  iv: string;
  aad: string;
  salt: string;
  passcode: string;
}) => {
  const key = await importOfflineContentKey(passcode, bytesFromBase64Url(salt));
  const plaintext = await subtle().decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(bytesFromBase64Url(iv)),
      additionalData: toArrayBuffer(bytesFromBase64Url(aad))
    },
    key,
    toArrayBuffer(bytesFromBase64Url(ciphertext))
  );
  const decoded = decodeUtf8(plaintext);
  const parsed: unknown = JSON.parse(decoded);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("type" in parsed) ||
    parsed.type !== "offline-secret-text" ||
    !("text" in parsed) ||
    typeof parsed.text !== "string"
  ) {
    throw new Error("Invalid offline secret payload");
  }
  return parsed.text;
};
