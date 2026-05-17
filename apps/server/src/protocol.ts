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

export interface CipherMessage {
  messageId: string;
  senderClientId: string;
  iv: string;
  ciphertext: string;
  burnAfterMs: 5000 | 10000 | 30000 | 60000;
  createdAt: number;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const getEventType = (value: unknown): string =>
  isRecord(value) && typeof value.type === "string" ? value.type : "unknown";
