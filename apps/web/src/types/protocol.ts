export type RoomState =
  | "idle"
  | "joining"
  | "waiting"
  | "active"
  | "hidden"
  | "unavailable"
  | "destroyed";

export type BurnAfterMs = 5000 | 10000 | 30000 | 60000;

export const burnOptions: Array<{ value: BurnAfterMs; label: string }> = [
  { value: 5000, label: "5s" },
  { value: 10000, label: "10s" },
  { value: 30000, label: "30s" },
  { value: 60000, label: "60s" }
];

export interface CipherMessage {
  messageId: string;
  senderClientId: string;
  iv: string;
  ciphertext: string;
  burnAfterMs: BurnAfterMs;
  createdAt: number;
}

export interface LocalMessage {
  id: string;
  from: "me" | "peer";
  text: string;
  burnAfterMs: BurnAfterMs;
  createdAt: number;
  status: "pending" | "visible" | "burning";
  seenAt?: number;
  expireAt?: number;
}

export type ClientEvent =
  | {
      type: "room:join";
      roomIdHash: string;
      clientId: string;
      publicKey: string;
    }
  | {
      type: "message:send";
      roomIdHash: string;
      clientId: string;
      message: CipherMessage;
    }
  | {
      type: "message:seen";
      roomIdHash: string;
      clientId: string;
      messageId: string;
      seenAt: number;
    }
  | {
      type: "message:burn";
      roomIdHash: string;
      clientId: string;
      messageId: string;
      burnedAt: number;
    }
  | {
      type: "room:destroy";
      roomIdHash: string;
      clientId: string;
    }
  | {
      type: "ping";
      clientId?: string;
      sentAt?: number;
    };

export type ServerEvent =
  | { type: "room:waiting" }
  | {
      type: "room:active";
      peers: Array<{ clientId: string; publicKey: string }>;
      serverTime: number;
    }
  | { type: "room:unavailable" }
  | { type: "message:receive"; message: CipherMessage }
  | { type: "message:seen"; messageId: string; seenBy: string; seenAt: number }
  | { type: "message:burn"; messageId: string; burnedAt: number }
  | { type: "peer:left" }
  | { type: "room:destroyed" }
  | { type: "error"; message: string }
  | { type: "pong"; sentAt?: number; serverTime: number };
