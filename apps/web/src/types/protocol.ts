export type RoomState =
  | "idle"
  | "joining"
  | "waiting"
  | "active"
  | "peer_offline"
  | "suspended"
  | "unavailable"
  | "destroyed"
  | "expired";

export type BurnAfterMs = 5000 | 10000 | 30000 | 60000;
export type ClientPlatform = "web" | "android" | "ios";
export type AttachmentKind = "image" | "video";
export type OfflineUnreadTtlMs = 3600000 | 86400000 | 604800000;
export type OfflineReadTtlMs = 5000 | 30000 | 60000;
export type SecurityEventKind = "screenshot" | "screen_recording_started" | "screen_recording_stopped" | "screen_projection";

export const burnOptions: Array<{ value: BurnAfterMs; label: string }> = [
  { value: 5000, label: "5s" },
  { value: 10000, label: "10s" },
  { value: 30000, label: "30s" },
  { value: 60000, label: "60s" }
];

export const offlineUnreadTtlOptions: Array<{ value: OfflineUnreadTtlMs; label: string }> = [
  { value: 3600000, label: "1h" },
  { value: 86400000, label: "24h" },
  { value: 604800000, label: "7d" }
];

export const offlineReadTtlOptions: Array<{ value: OfflineReadTtlMs; label: string }> = [
  { value: 5000, label: "5s" },
  { value: 30000, label: "30s" },
  { value: 60000, label: "60s" }
];

export const maxAttachmentBytes = 4 * 1024 * 1024;

export interface EncryptedAttachmentPayload {
  version: 1;
  type: "attachment";
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  data: string;
}

export interface LocalAttachment {
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
}

export interface DecryptedLocalAttachment extends LocalAttachment {
  bytes: Uint8Array;
}

export interface DisplayLocalAttachment extends LocalAttachment {
  objectUrl: string;
}

export type PendingMessageState =
  | "stored"
  | "delivered"
  | "decrypted"
  | "visible"
  | "seen"
  | "burning";

export type LocalMessageStatus =
  | "sending"
  | "server_ack"
  | "stored"
  | "delivered"
  | "decrypted"
  | "visible"
  | "seen"
  | "burning"
  | "burned"
  | "failed"
  | "peer_offline"
  | "undecryptable";

export interface CipherMessage {
  roomIdHash: string;
  messageId: string;
  senderClientId: string;
  iv: string;
  ciphertext: string;
  aad: string;
  burnAfterMs: BurnAfterMs;
  createdAt: number;
}

export interface HistoryMessage extends CipherMessage {
  expireAt: number;
  state: PendingMessageState;
  seenAt?: number;
  burnAt?: number;
}

export interface LocalMessage {
  id: string;
  from: "me" | "peer" | "system";
  systemText?: string;
  decryptedText?: string;
  displayText?: string;
  decryptedAttachment?: DecryptedLocalAttachment;
  displayAttachment?: DisplayLocalAttachment;
  ciphertext?: string;
  iv?: string;
  aad?: string;
  burnAfterMs: BurnAfterMs;
  createdAt: number;
  seenAt?: number;
  burnAt?: number;
  revealedAt?: number;
  status: LocalMessageStatus;
}

export interface PeerPresence {
  clientId: string;
  platform: ClientPlatform;
  openedAt: number;
  lastSeenAt: number;
}

export interface PeerPresenceView {
  status: "unknown" | "online" | "offline";
  platform?: ClientPlatform;
  openedAt?: number;
  lastSeenAt?: number;
}

export type ClientEvent =
  | {
      type: "room:join";
      roomIdHash: string;
      clientId: string;
      platform?: ClientPlatform;
    }
  | {
      type: "room:leave";
      roomIdHash: string;
      clientId: string;
    }
  | {
      type: "room:destroy";
      roomIdHash: string;
      clientId: string;
    }
  | {
      type: "room:sync";
      roomIdHash: string;
      clientId: string;
    }
  | {
      type: "message:send";
      roomIdHash: string;
      clientId: string;
      message: CipherMessage;
    }
  | {
      type: "message:delivered" | "message:decrypted" | "message:visible";
      roomIdHash: string;
      clientId: string;
      messageId: string;
      at: number;
    }
  | {
      type: "message:seen";
      roomIdHash: string;
      clientId: string;
      messageId: string;
      confirm: "user-click";
    }
  | {
      type: "message:burn";
      roomIdHash: string;
      clientId: string;
      messageId: string;
      burnedAt: number;
    }
  | {
      type: "security:event";
      roomIdHash: string;
      clientId: string;
      kind: SecurityEventKind;
      platform: ClientPlatform;
      blocked: boolean;
      detectedAt: number;
    }
  | {
      type: "ping";
      clientId?: string;
      sentAt?: number;
    };

export type ServerEvent =
  | { type: "room:waiting"; serverTime: number }
  | { type: "room:active"; serverTime: number }
  | { type: "room:peer_offline"; serverTime: number }
  | { type: "room:suspended"; serverTime: number }
  | { type: "room:resumed"; serverTime: number }
  | { type: "room:destroyed"; serverTime: number }
  | { type: "room:expired"; serverTime: number }
  | { type: "room:unavailable" }
  | { type: "room:sync"; serverTime: number }
  | { type: "presence:update"; peers: PeerPresence[]; serverTime: number }
  | { type: "message:server_ack"; messageId: string; state: "server_ack" | "stored"; serverTime: number }
  | { type: "message:receive"; message: CipherMessage; state: PendingMessageState; serverTime: number }
  | { type: "message:history"; messages: HistoryMessage[]; serverTime: number }
  | { type: "message:delivered"; messageId: string; byClientId: string; at: number }
  | { type: "message:decrypted"; messageId: string; byClientId: string; at: number }
  | { type: "message:visible"; messageId: string; byClientId: string; at: number }
  | { type: "message:seen"; messageId: string; seenBy: string; seenAt: number; burnAt: number; serverTime: number }
  | { type: "message:burn"; messageId: string; burnedAt: number; serverTime: number }
  | { type: "message:failed"; messageId?: string; reason: "unavailable" | "invalid" | "rate_limited" }
  | {
      type: "security:event";
      kind: SecurityEventKind;
      platform: ClientPlatform;
      blocked: boolean;
      detectedAt: number;
      byClientId: string;
      serverTime: number;
    }
  | { type: "peer:left"; serverTime: number }
  | { type: "peer:reconnected"; serverTime: number }
  | { type: "error"; message: string }
  | { type: "pong"; sentAt?: number; serverTime: number };

export interface OfflineSecretKdfParams {
  version: 1;
  namespace: "offline-secret-v1";
  algorithm: "PBKDF2-SHA256-AES-GCM";
  iterations: number;
}

export interface OfflineSecretCreateResponse {
  secretId: string;
  readToken: string;
  createdAt: number;
  unreadExpireAt: number;
  readTtlMs: OfflineReadTtlMs;
}

export interface OfflineSecretMetaResponse {
  secretId: string;
  status: "stored" | "reading" | "burned" | "expired";
  salt: string;
  kdfParams: string;
  readTtlMs: OfflineReadTtlMs;
  createdAt: number;
  unreadExpireAt: number;
  readAt?: number;
  readExpireAt?: number;
  burnedAt?: number;
}

export interface OfflineSecretOpenResponse extends OfflineSecretMetaResponse {
  ciphertext: string;
  iv: string;
  aad: string;
  readTtlMs: OfflineReadTtlMs;
}
