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

export const burnOptions: Array<{ value: BurnAfterMs; label: string }> = [
  { value: 5000, label: "5s" },
  { value: 10000, label: "10s" },
  { value: 30000, label: "30s" },
  { value: 60000, label: "60s" }
];

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
  from: "me" | "peer";
  decryptedText?: string;
  displayText?: string;
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

export type ClientEvent =
  | {
      type: "room:join";
      roomIdHash: string;
      clientId: string;
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
  | { type: "message:server_ack"; messageId: string; state: "server_ack" | "stored"; serverTime: number }
  | { type: "message:receive"; message: CipherMessage; state: PendingMessageState; serverTime: number }
  | { type: "message:history"; messages: HistoryMessage[]; serverTime: number }
  | { type: "message:delivered"; messageId: string; byClientId: string; at: number }
  | { type: "message:decrypted"; messageId: string; byClientId: string; at: number }
  | { type: "message:visible"; messageId: string; byClientId: string; at: number }
  | { type: "message:seen"; messageId: string; seenBy: string; seenAt: number; burnAt: number; serverTime: number }
  | { type: "message:burn"; messageId: string; burnedAt: number; serverTime: number }
  | { type: "message:failed"; messageId?: string; reason: "unavailable" | "invalid" | "rate_limited" }
  | { type: "peer:left"; serverTime: number }
  | { type: "peer:reconnected"; serverTime: number }
  | { type: "error"; message: string }
  | { type: "pong"; sentAt?: number; serverTime: number };
