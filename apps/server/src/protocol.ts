export type BurnAfterMs = 5000 | 10000 | 30000 | 60000;
export type SecurityEventKind = "screenshot" | "screen_recording_started" | "screen_recording_stopped" | "screen_projection";

export type PendingMessageState =
  | "stored"
  | "delivered"
  | "decrypted"
  | "visible"
  | "seen"
  | "burning";

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

export interface LegacyCipherMessage {
  messageId: string;
  senderClientId: string;
  iv: string;
  ciphertext: string;
  burnAfterMs: BurnAfterMs;
  createdAt: number;
}

export type ClientCipherMessage = CipherMessage | LegacyCipherMessage;

export interface HistoryMessage extends CipherMessage {
  expireAt: number;
  state: PendingMessageState;
  seenAt?: number;
  burnAt?: number;
}

export type ClientEvent =
  | {
      type: "room:join";
      roomIdHash: string;
      clientId: string;
      publicKey?: string;
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
      message: ClientCipherMessage;
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
      platform: "android" | "ios" | "web";
      blocked: boolean;
      detectedAt: number;
    }
  | {
      type: "ping";
      clientId?: string;
      sentAt?: number;
    };

export interface RoomPeer {
  clientId: string;
  publicKey: string;
}

export type ServerEvent =
  | { type: "room:waiting"; serverTime: number }
  | { type: "room:active"; serverTime: number; peers?: RoomPeer[] }
  | { type: "room:peer_offline"; serverTime: number }
  | { type: "room:suspended"; serverTime: number }
  | { type: "room:resumed"; serverTime: number }
  | { type: "room:destroyed"; serverTime: number }
  | { type: "room:expired"; serverTime: number }
  | { type: "room:unavailable" }
  | { type: "room:sync"; serverTime: number }
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
      platform: "android" | "ios" | "web";
      blocked: boolean;
      detectedAt: number;
      byClientId: string;
      serverTime: number;
    }
  | { type: "peer:left"; serverTime: number }
  | { type: "peer:reconnected"; serverTime: number }
  | { type: "error"; message: string }
  | { type: "pong"; sentAt?: number; serverTime: number };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const getEventType = (value: unknown): string =>
  isRecord(value) && typeof value.type === "string" ? value.type : "unknown";
