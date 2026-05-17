import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { URL } from "node:url";
import fastify from "fastify";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  type BurnAfterMs,
  type CipherMessage,
  type ClientEvent,
  type HistoryMessage,
  type PendingMessageState,
  type ServerEvent,
  getEventType,
  isRecord
} from "./protocol.js";
import { checkJoin, checkSend, createIpRiskHash } from "./rateLimit.js";

type RoomLifecycleStatus = "waiting" | "active" | "peer_offline" | "suspended" | "destroyed" | "expired";

interface ClientState {
  ws: WebSocket;
  ipRiskHash: string;
  clientId?: string;
  roomIdHash?: string;
  joinedAt: number;
  lastSeenAt: number;
  closed: boolean;
}

interface PendingEncryptedMessage extends HistoryMessage {
  state: PendingMessageState;
}

interface RoomState {
  roomIdHash: string;
  status: RoomLifecycleStatus;
  clients: Map<string, ClientState>;
  pendingMessages: Map<string, PendingEncryptedMessage>;
  burnedMessageIds: Map<string, number>;
  createdAt: number;
  updatedAt: number;
  expireAt: number;
  suspendedAt?: number;
  destroying: boolean;
  hadPeer: boolean;
}

const port = Number.parseInt(process.env.PORT ?? "3101", 10);
const host = process.env.HOST ?? "0.0.0.0";
const roomTtlMs = Number.parseInt(process.env.ROOM_TTL_MS ?? "86400000", 10);
const suspendedRoomTtlMs = Number.parseInt(process.env.ROOM_SUSPENDED_TTL_MS ?? "7200000", 10);
const messageTtlMs = Number.parseInt(process.env.MESSAGE_TTL_MS ?? "7200000", 10);
const burnedIdTtlMs = Number.parseInt(process.env.BURNED_ID_TTL_MS ?? "7200000", 10);
const clientTimeoutMs = Number.parseInt(process.env.CLIENT_TIMEOUT_MS ?? "35000", 10);
const ipHashSecret =
  process.env.IP_HASH_SECRET && process.env.IP_HASH_SECRET.length >= 32
    ? process.env.IP_HASH_SECRET
    : randomBytes(32).toString("hex");

const app = fastify({
  disableRequestLogging: true,
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie"],
      censor: "[redacted]"
    }
  }
});

const wss = new WebSocketServer({ noServer: true });
const rooms = new Map<string, RoomState>();
const clients = new Set<ClientState>();

const unavailableMessage = "房间暂不可用";
const frequentMessage = "连接过于频繁，请稍后再试";
const short = (value: string | undefined) => (value ? value.slice(0, 8) : undefined);

const logWs = (
  event: string,
  meta: {
    roomIdHash?: string | undefined;
    clientId?: string | undefined;
    messageId?: string | undefined;
    errorType?: string | undefined;
    risk?: string | undefined;
    result?: string | undefined;
    state?: string | undefined;
  } = {}
) => {
  app.log.info(
    {
      event,
      room: short(meta.roomIdHash),
      client: short(meta.clientId),
      message: short(meta.messageId),
      errorType: meta.errorType,
      risk: meta.risk,
      result: meta.result,
      state: meta.state
    },
    "ws"
  );
};

const send = (client: ClientState, event: ServerEvent) => {
  if (client.ws.readyState !== WebSocket.OPEN) return;
  client.ws.send(JSON.stringify(event));
};

const broadcast = (room: RoomState, event: ServerEvent) => {
  for (const client of room.clients.values()) {
    send(client, event);
  }
};

const sendError = (client: ClientState, message = unavailableMessage) => {
  send(client, { type: "error", message });
};

const normalizeIp = (request: IncomingMessage) => {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return request.socket.remoteAddress ?? "unknown";
};

const isSafeToken = (value: unknown, min: number, max: number) =>
  typeof value === "string" &&
  value.length >= min &&
  value.length <= max &&
  /^[A-Za-z0-9_-]+$/.test(value);

const isRoomHash = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

const isBurnAfter = (value: unknown): value is BurnAfterMs =>
  value === 5000 || value === 10000 || value === 30000 || value === 60000;

const isCipherMessage = (value: unknown): value is CipherMessage => {
  if (!isRecord(value)) return false;
  return (
    isRoomHash(value.roomIdHash) &&
    isSafeToken(value.messageId, 12, 96) &&
    isSafeToken(value.senderClientId, 12, 96) &&
    isSafeToken(value.iv, 12, 64) &&
    isSafeToken(value.aad, 16, 512) &&
    typeof value.ciphertext === "string" &&
    value.ciphertext.length > 0 &&
    value.ciphertext.length <= 32_768 &&
    /^[A-Za-z0-9_-]+$/.test(value.ciphertext) &&
    isBurnAfter(value.burnAfterMs) &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt)
  );
};

const createRoom = (roomIdHash: string, now = Date.now()): RoomState => ({
  roomIdHash,
  status: "waiting",
  clients: new Map(),
  pendingMessages: new Map(),
  burnedMessageIds: new Map(),
  createdAt: now,
  updatedAt: now,
  expireAt: now + roomTtlMs,
  destroying: false,
  hadPeer: false
});

const toHistoryMessage = (message: PendingEncryptedMessage): HistoryMessage => ({
  roomIdHash: message.roomIdHash,
  messageId: message.messageId,
  senderClientId: message.senderClientId,
  iv: message.iv,
  ciphertext: message.ciphertext,
  aad: message.aad,
  burnAfterMs: message.burnAfterMs,
  createdAt: message.createdAt,
  expireAt: message.expireAt,
  state: message.state,
  ...(typeof message.seenAt === "number" ? { seenAt: message.seenAt } : {}),
  ...(typeof message.burnAt === "number" ? { burnAt: message.burnAt } : {})
});

const pruneRoomMessages = (room: RoomState, now = Date.now()) => {
  for (const [messageId, expiresAt] of room.burnedMessageIds.entries()) {
    if (expiresAt <= now) room.burnedMessageIds.delete(messageId);
  }

  for (const [messageId, message] of room.pendingMessages.entries()) {
    if (room.burnedMessageIds.has(messageId) || message.expireAt <= now) {
      room.pendingMessages.delete(messageId);
      continue;
    }

    if (message.state === "burning" && typeof message.burnAt === "number" && message.burnAt <= now) {
      room.pendingMessages.delete(messageId);
      room.burnedMessageIds.set(messageId, now + burnedIdTtlMs);
    }
  }
};

const sendHistory = (client: ClientState, room: RoomState) => {
  pruneRoomMessages(room);
  send(client, {
    type: "message:history",
    messages: [...room.pendingMessages.values()].map(toHistoryMessage),
    serverTime: Date.now()
  });
};

const expireRoom = (room: RoomState, reason: "expired" | "destroyed") => {
  if (room.destroying) return;
  room.destroying = true;
  room.status = reason === "expired" ? "expired" : "destroyed";
  rooms.delete(room.roomIdHash);

  const event: ServerEvent =
    reason === "expired" ? { type: "room:expired", serverTime: Date.now() } : { type: "room:destroyed", serverTime: Date.now() };

  for (const client of room.clients.values()) {
    delete client.roomIdHash;
    send(client, event);
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.close(1000, reason);
    }
  }

  room.clients.clear();
  room.pendingMessages.clear();
  room.burnedMessageIds.clear();

  logWs(`room:${reason}`, {
    roomIdHash: room.roomIdHash,
    result: "deleted"
  });
};

const detachClientFromRoom = (client: ClientState, reason: string) => {
  const roomIdHash = client.roomIdHash;
  const clientId = client.clientId;
  if (!roomIdHash || !clientId) return;

  const room = rooms.get(roomIdHash);
  delete client.roomIdHash;
  if (!room) return;

  room.clients.delete(clientId);
  room.updatedAt = Date.now();

  if (room.destroying) return;

  if (room.clients.size === 0) {
    room.status = "suspended";
    room.suspendedAt = Date.now();
    logWs("room:suspended", {
      roomIdHash,
      clientId,
      errorType: reason,
      result: "retained"
    });
    return;
  }

  room.status = "peer_offline";
  delete room.suspendedAt;
  for (const remaining of room.clients.values()) {
    send(remaining, { type: "peer:left", serverTime: Date.now() });
    send(remaining, { type: "room:peer_offline", serverTime: Date.now() });
  }

  logWs("room:peer_offline", {
    roomIdHash,
    clientId,
    errorType: reason,
    result: "retained"
  });
};

const cleanupClient = (client: ClientState, reason: string) => {
  if (client.closed) return;
  client.closed = true;
  clients.delete(client);
  detachClientFromRoom(client, reason);
  logWs("client:close", {
    roomIdHash: client.roomIdHash,
    clientId: client.clientId,
    errorType: reason
  });
};

const getJoinedRoom = (client: ClientState, roomIdHash: string, clientId: string) => {
  if (client.roomIdHash !== roomIdHash || client.clientId !== clientId) return undefined;
  const room = rooms.get(roomIdHash);
  if (!room || room.destroying || !room.clients.has(clientId)) return undefined;
  return room;
};

const handleJoin = (client: ClientState, event: Extract<ClientEvent, { type: "room:join" }>) => {
  if (!isRoomHash(event.roomIdHash) || !isSafeToken(event.clientId, 12, 96)) {
    send(client, { type: "room:unavailable" });
    logWs("room:join", {
      roomIdHash: typeof event.roomIdHash === "string" ? event.roomIdHash : undefined,
      clientId: typeof event.clientId === "string" ? event.clientId : undefined,
      errorType: "invalid",
      result: "rejected"
    });
    return;
  }

  const risk = checkJoin(client.ipRiskHash, event.roomIdHash);
  if (!risk.allowed) {
    sendError(client, frequentMessage);
    logWs("room:join", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      risk: risk.reason,
      result: "limited"
    });
    return;
  }

  if (client.roomIdHash) {
    detachClientFromRoom(client, "rejoin");
  }

  const now = Date.now();
  const existing = rooms.get(event.roomIdHash);
  const room = existing ?? createRoom(event.roomIdHash, now);

  pruneRoomMessages(room, now);

  if (room.destroying || room.expireAt <= now || room.clients.size >= 2) {
    send(client, { type: "room:unavailable" });
    logWs("room:join", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      result: "unavailable"
    });
    return;
  }

  const previousStatus = room.status;
  rooms.set(event.roomIdHash, room);

  client.clientId = event.clientId;
  client.roomIdHash = event.roomIdHash;
  client.joinedAt = now;
  client.lastSeenAt = now;
  client.closed = false;
  room.clients.set(event.clientId, client);
  room.updatedAt = now;

  if (previousStatus === "suspended") {
    send(client, { type: "room:resumed", serverTime: now });
  }

  if (room.clients.size === 1) {
    room.status = room.hadPeer ? "peer_offline" : "waiting";
    delete room.suspendedAt;
    send(client, {
      type: room.status === "waiting" ? "room:waiting" : "room:peer_offline",
      serverTime: now
    });
    sendHistory(client, room);
    logWs("room:join", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      result: room.status
    });
    return;
  }

  room.status = "active";
  room.hadPeer = true;
  delete room.suspendedAt;
  for (const peer of room.clients.values()) {
    send(peer, { type: "room:active", serverTime: now });
    if (peer.clientId !== event.clientId) {
      send(peer, { type: "peer:reconnected", serverTime: now });
    }
  }
  sendHistory(client, room);

  logWs("room:join", {
    roomIdHash: event.roomIdHash,
    clientId: event.clientId,
    result: "active"
  });
};

const handleLeave = (client: ClientState, event: Extract<ClientEvent, { type: "room:leave" }>) => {
  if (!isRoomHash(event.roomIdHash) || !isSafeToken(event.clientId, 12, 96)) return;
  if (client.roomIdHash !== event.roomIdHash || client.clientId !== event.clientId) return;
  detachClientFromRoom(client, "leave");
};

const handleSync = (client: ClientState, event: Extract<ClientEvent, { type: "room:sync" }>) => {
  if (!isRoomHash(event.roomIdHash) || !isSafeToken(event.clientId, 12, 96)) {
    send(client, { type: "room:unavailable" });
    return;
  }

  const room = getJoinedRoom(client, event.roomIdHash, event.clientId);
  if (!room) {
    send(client, { type: "room:unavailable" });
    return;
  }

  send(client, { type: "room:sync", serverTime: Date.now() });
  sendHistory(client, room);
};

const handleSend = (client: ClientState, event: Extract<ClientEvent, { type: "message:send" }>) => {
  if (
    !isRoomHash(event.roomIdHash) ||
    !isSafeToken(event.clientId, 12, 96) ||
    !isCipherMessage(event.message) ||
    event.message.roomIdHash !== event.roomIdHash ||
    event.message.senderClientId !== event.clientId
  ) {
    const messageId = isRecord(event.message) && typeof event.message.messageId === "string" ? event.message.messageId : undefined;
    send(client, {
      type: "message:failed",
      ...(messageId ? { messageId } : {}),
      reason: "invalid"
    });
    logWs("message:send", {
      roomIdHash: typeof event.roomIdHash === "string" ? event.roomIdHash : undefined,
      clientId: typeof event.clientId === "string" ? event.clientId : undefined,
      errorType: "invalid",
      result: "rejected"
    });
    return;
  }

  const risk = checkSend(client.ipRiskHash);
  if (!risk.allowed) {
    send(client, { type: "message:failed", messageId: event.message.messageId, reason: "rate_limited" });
    sendError(client, frequentMessage);
    logWs("message:send", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      messageId: event.message.messageId,
      risk: risk.reason,
      result: "limited"
    });
    return;
  }

  const room = getJoinedRoom(client, event.roomIdHash, event.clientId);
  if (!room || room.status === "destroyed" || room.status === "expired") {
    send(client, { type: "message:failed", messageId: event.message.messageId, reason: "unavailable" });
    logWs("message:send", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      messageId: event.message.messageId,
      errorType: "room",
      result: "rejected"
    });
    return;
  }

  const now = Date.now();
  const pending: PendingEncryptedMessage = {
    ...event.message,
    expireAt: Math.min(now + messageTtlMs, room.expireAt),
    state: "stored"
  };
  room.pendingMessages.set(event.message.messageId, pending);
  room.updatedAt = now;

  send(client, {
    type: "message:server_ack",
    messageId: event.message.messageId,
    state: "stored",
    serverTime: now
  });

  for (const peer of room.clients.values()) {
    if (peer.clientId !== event.clientId) {
      send(peer, { type: "message:receive", message: event.message, state: pending.state, serverTime: now });
    }
  }

  logWs("message:send", {
    roomIdHash: event.roomIdHash,
    clientId: event.clientId,
    messageId: event.message.messageId,
    result: room.clients.size > 1 ? "forwarded" : "stored",
    state: pending.state
  });
};

const progressRank: Record<PendingMessageState, number> = {
  stored: 1,
  delivered: 2,
  decrypted: 3,
  visible: 4,
  seen: 5,
  burning: 6
};

const handleMessageProgress = (
  client: ClientState,
  event: Extract<ClientEvent, { type: "message:delivered" | "message:decrypted" | "message:visible" }>
) => {
  if (!isRoomHash(event.roomIdHash) || !isSafeToken(event.clientId, 12, 96) || !isSafeToken(event.messageId, 12, 96)) {
    sendError(client);
    return;
  }

  const room = getJoinedRoom(client, event.roomIdHash, event.clientId);
  const message = room?.pendingMessages.get(event.messageId);
  if (!room || !message || message.senderClientId === event.clientId || message.state === "burning") return;

  const nextState = event.type.replace("message:", "") as "delivered" | "decrypted" | "visible";
  if (progressRank[message.state] < progressRank[nextState]) {
    message.state = nextState;
    room.updatedAt = Date.now();
  }

  broadcast(room, {
    type: event.type,
    messageId: event.messageId,
    byClientId: event.clientId,
    at: Number.isFinite(event.at) ? event.at : Date.now()
  });

  logWs(event.type, {
    roomIdHash: event.roomIdHash,
    clientId: event.clientId,
    messageId: event.messageId,
    result: "broadcast",
    state: message.state
  });
};

const handleSeen = (client: ClientState, event: Extract<ClientEvent, { type: "message:seen" }>) => {
  if (!isRoomHash(event.roomIdHash) || !isSafeToken(event.clientId, 12, 96) || !isSafeToken(event.messageId, 12, 96)) {
    sendError(client);
    return;
  }

  const room = getJoinedRoom(client, event.roomIdHash, event.clientId);
  const message = room?.pendingMessages.get(event.messageId);
  if (
    !room ||
    room.status !== "active" ||
    !message ||
    message.senderClientId === event.clientId ||
    progressRank[message.state] < progressRank.visible
  ) {
    logWs("message:seen", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      messageId: event.messageId,
      result: "ignored"
    });
    return;
  }

  const seenAt = Number.isFinite(event.seenAt) ? event.seenAt : Date.now();
  message.state = "burning";
  message.seenAt = seenAt;
  message.burnAt = seenAt + message.burnAfterMs;
  room.updatedAt = Date.now();

  broadcast(room, {
    type: "message:seen",
    messageId: event.messageId,
    seenBy: event.clientId,
    seenAt,
    burnAt: message.burnAt
  });

  logWs("message:seen", {
    roomIdHash: event.roomIdHash,
    clientId: event.clientId,
    messageId: event.messageId,
    result: "broadcast",
    state: message.state
  });
};

const handleBurn = (client: ClientState, event: Extract<ClientEvent, { type: "message:burn" }>) => {
  if (!isRoomHash(event.roomIdHash) || !isSafeToken(event.clientId, 12, 96) || !isSafeToken(event.messageId, 12, 96)) {
    sendError(client);
    return;
  }

  const room = getJoinedRoom(client, event.roomIdHash, event.clientId);
  if (!room) return;

  const now = Date.now();
  room.pendingMessages.delete(event.messageId);
  room.burnedMessageIds.set(event.messageId, now + burnedIdTtlMs);
  room.updatedAt = now;

  broadcast(room, {
    type: "message:burn",
    messageId: event.messageId,
    burnedAt: Number.isFinite(event.burnedAt) ? event.burnedAt : now
  });

  logWs("message:burn", {
    roomIdHash: event.roomIdHash,
    clientId: event.clientId,
    messageId: event.messageId,
    result: "deleted"
  });
};

const handleDestroy = (client: ClientState, event: Extract<ClientEvent, { type: "room:destroy" }>) => {
  if (!isRoomHash(event.roomIdHash) || !isSafeToken(event.clientId, 12, 96)) {
    send(client, { type: "room:unavailable" });
    return;
  }

  const room = getJoinedRoom(client, event.roomIdHash, event.clientId);
  if (!room) {
    send(client, { type: "room:unavailable" });
    return;
  }

  expireRoom(room, "destroyed");
};

const parseClientEvent = (data: RawData): ClientEvent | undefined => {
  const text = Array.isArray(data)
    ? Buffer.concat(data).toString("utf8")
    : Buffer.isBuffer(data)
      ? data.toString("utf8")
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString("utf8")
        : Buffer.from(data).toString("utf8");

  if (Buffer.byteLength(text, "utf8") > 40_000) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || typeof parsed.type !== "string") return undefined;
    return parsed as ClientEvent;
  } catch {
    return undefined;
  }
};

wss.on("connection", (ws, request) => {
  const ipRiskHash = createIpRiskHash(ipHashSecret, normalizeIp(request));
  const client: ClientState = {
    ws,
    ipRiskHash,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
    closed: false
  };
  clients.add(client);

  ws.on("message", (data) => {
    const event = parseClientEvent(data);
    const eventType = getEventType(event);
    client.lastSeenAt = Date.now();

    if (!event) {
      sendError(client);
      logWs("unknown", {
        roomIdHash: client.roomIdHash,
        clientId: client.clientId,
        errorType: "parse",
        result: "rejected"
      });
      return;
    }

    switch (event.type) {
      case "room:join":
        handleJoin(client, event);
        break;
      case "room:leave":
        handleLeave(client, event);
        break;
      case "room:destroy":
        handleDestroy(client, event);
        break;
      case "room:sync":
        handleSync(client, event);
        break;
      case "message:send":
        handleSend(client, event);
        break;
      case "message:delivered":
      case "message:decrypted":
      case "message:visible":
        handleMessageProgress(client, event);
        break;
      case "message:seen":
        handleSeen(client, event);
        break;
      case "message:burn":
        handleBurn(client, event);
        break;
      case "ping":
        send(client, {
          type: "pong",
          ...(typeof event.sentAt === "number" ? { sentAt: event.sentAt } : {}),
          serverTime: Date.now()
        });
        logWs("ping", {
          roomIdHash: client.roomIdHash,
          clientId: client.clientId ?? event.clientId,
          result: "pong"
        });
        break;
      default:
        sendError(client);
        logWs(eventType, {
          roomIdHash: client.roomIdHash,
          clientId: client.clientId,
          errorType: "unknown",
          result: "rejected"
        });
    }
  });

  ws.on("close", () => cleanupClient(client, "close"));
  ws.on("error", () => cleanupClient(client, "socket-error"));
});

setInterval(() => {
  const now = Date.now();

  for (const client of [...clients]) {
    if (now - client.lastSeenAt > clientTimeoutMs) {
      logWs("client:timeout", {
        roomIdHash: client.roomIdHash,
        clientId: client.clientId,
        result: "closing"
      });
      client.ws.close(1001, "timeout");
      cleanupClient(client, "timeout");
    }
  }

  for (const room of [...rooms.values()]) {
    pruneRoomMessages(room, now);

    if (room.expireAt <= now) {
      expireRoom(room, "expired");
      continue;
    }

    if (room.status === "suspended" && room.suspendedAt && now - room.suspendedAt > suspendedRoomTtlMs) {
      expireRoom(room, "expired");
    }
  }
}, 10_000).unref();

app.get("/health", async () => ({
  ok: true,
  rooms: rooms.size,
  clients: clients.size,
  pendingMessages: [...rooms.values()].reduce((total, room) => total + room.pendingMessages.size, 0)
}));

app.get("/", async () => ({
  name: "secret-room-server",
  ok: true
}));

app.server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (connected) => {
    wss.emit("connection", connected, request);
  });
});

await app.listen({ port, host });
app.log.info({ port, host }, "secret-room server listening");
