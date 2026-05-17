import type { BurnAfterMs, CipherMessage } from "@/types/protocol";
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

export interface RoomMaterial {
  roomIdHash: string;
  roomMessageKey: CryptoKey;
  securityCode: string;
}

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
    toArrayBuffer(encodeUtf8(text))
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

export const decryptText = async (
  roomMessageKey: CryptoKey,
  roomIdHash: string,
  message: CipherMessage
): Promise<string> => {
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

  return decodeUtf8(plaintext);
};
