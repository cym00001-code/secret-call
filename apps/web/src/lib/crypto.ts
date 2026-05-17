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

export interface RoomSecrets {
  roomIdHash: string;
  psk: ArrayBuffer;
}

export interface EcdhMaterial {
  privateKey: CryptoKey;
  publicKey: string;
}

export interface SessionMaterial {
  sessionKey: CryptoKey;
  securityCode: string;
  transcriptHash: string;
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

export const deriveRoomSecrets = async (roomNumber: string, passphrase: string): Promise<RoomSecrets> => {
  const room = normalize(roomNumber);
  const pass = normalize(passphrase);
  const passwordKey = await subtle().importKey("raw", toArrayBuffer(encodeUtf8(pass)), "PBKDF2", false, ["deriveBits"]);
  const salt = encodeFrame(["secret-room-psk-v1", room]);
  const pskBits = await subtle().deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations: 150_000
    },
    passwordKey,
    256
  );
  const psk = toArrayBuffer(pskBits);
  const roomIdDigest = await subtle().digest(
    "SHA-256",
    toArrayBuffer(encodeFrame(["secret-room-room-hash-v1", room, base64UrlFromBytes(psk)]))
  );

  return {
    roomIdHash: bytesToHex(roomIdDigest),
    psk
  };
};

export const generateEcdhMaterial = async (): Promise<EcdhMaterial> => {
  const keyPair = await subtle().generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    false,
    ["deriveBits"]
  );
  const publicKeyRaw = await subtle().exportKey("raw", keyPair.publicKey);

  return {
    privateKey: keyPair.privateKey,
    publicKey: base64UrlFromBytes(publicKeyRaw)
  };
};

export const deriveSessionMaterial = async (
  privateKey: CryptoKey,
  psk: ArrayBuffer,
  roomIdHash: string,
  localPublicKey: string,
  peerPublicKey: string
): Promise<SessionMaterial> => {
  const peerRaw = bytesFromBase64Url(peerPublicKey);
  const importedPeer = await subtle().importKey(
    "raw",
    toArrayBuffer(peerRaw),
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    false,
    []
  );
  const sharedSecret = await subtle().deriveBits(
    {
      name: "ECDH",
      public: importedPeer
    },
    privateKey,
    256
  );
  const sortedPublicKeys = [localPublicKey, peerPublicKey].sort((a, b) => a.localeCompare(b));
  const info = toArrayBuffer(
    encodeFrame(["secret-room-v1", roomIdHash, sortedPublicKeys[0] ?? "", sortedPublicKeys[1] ?? ""])
  );
  const hkdfKey = await subtle().importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  const sessionKey = await subtle().deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: psk,
      info
    },
    hkdfKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
  const transcriptHashBytes = await subtle().digest(
    "SHA-256",
    toArrayBuffer(
      encodeFrame(["secret-room-transcript-v1", roomIdHash, sortedPublicKeys[0] ?? "", sortedPublicKeys[1] ?? ""])
    )
  );
  const transcriptHash = bytesToHex(transcriptHashBytes);
  const codeHashBytes = await subtle().digest(
    "SHA-256",
    toArrayBuffer(encodeFrame(["secret-room-code-v1", roomIdHash, transcriptHash]))
  );
  const securityCode = bytesToHex(codeHashBytes)
    .slice(0, 24)
    .toUpperCase()
    .match(/.{1,4}/gu)
    ?.join(" ") ?? "----";

  return {
    sessionKey,
    securityCode,
    transcriptHash
  };
};

export const aadForMessage = (
  roomIdHash: string,
  messageId: string,
  senderClientId: string,
  burnAfterMs: BurnAfterMs,
  createdAt: number
) => toArrayBuffer(encodeFrame(["sr-aad-v1", roomIdHash, messageId, senderClientId, burnAfterMs, createdAt]));

export const encryptText = async (
  sessionKey: CryptoKey,
  roomIdHash: string,
  senderClientId: string,
  text: string,
  burnAfterMs: BurnAfterMs
): Promise<CipherMessage> => {
  const messageId = randomToken("msg");
  const createdAt = Date.now();
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const ciphertext = await subtle().encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: aadForMessage(roomIdHash, messageId, senderClientId, burnAfterMs, createdAt)
    },
    sessionKey,
    toArrayBuffer(encodeUtf8(text))
  );

  return {
    messageId,
    senderClientId,
    iv: base64UrlFromBytes(iv),
    ciphertext: base64UrlFromBytes(ciphertext),
    burnAfterMs,
    createdAt
  };
};

export const decryptText = async (
  sessionKey: CryptoKey,
  roomIdHash: string,
  message: CipherMessage
): Promise<string> => {
  const plaintext = await subtle().decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(bytesFromBase64Url(message.iv)),
      additionalData: aadForMessage(
        roomIdHash,
        message.messageId,
        message.senderClientId,
        message.burnAfterMs,
        message.createdAt
      )
    },
    sessionKey,
    toArrayBuffer(bytesFromBase64Url(message.ciphertext))
  );

  return decodeUtf8(plaintext);
};
