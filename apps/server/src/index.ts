import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { URL } from "node:url";
import fastify from "fastify";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  type BurnAfterMs,
  type CipherMessage,
  type ClientCipherMessage,
  type ClientEvent,
  type HistoryMessage,
  type PendingMessageState,
  type ServerEvent,
  getEventType,
  isRecord
} from "./protocol.js";
import { OfflineSecretStore, resolveOfflineSecretDbPath } from "./offlineSecrets.js";
import { checkJoin, checkSend, createIpRiskHash } from "./rateLimit.js";

type RoomLifecycleStatus = "waiting" | "active" | "peer_offline" | "suspended" | "destroyed" | "expired";

interface ClientState {
  ws: WebSocket;
  ipRiskHash: string;
  clientId?: string;
  publicKey?: string;
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
const maxCiphertextChars = Number.parseInt(process.env.MAX_CIPHERTEXT_CHARS ?? "7600000", 10);
const maxClientEventBytes = Number.parseInt(process.env.MAX_CLIENT_EVENT_BYTES ?? "8200000", 10);
const maxRoomPendingCiphertextChars = Number.parseInt(process.env.MAX_ROOM_PENDING_CIPHERTEXT_CHARS ?? "16000000", 10);
const maxOfflineSecretCiphertextChars = Number.parseInt(process.env.MAX_OFFLINE_SECRET_CIPHERTEXT_CHARS ?? "2000000", 10);
const disableRateLimit = process.env.DISABLE_RATE_LIMIT === "1";
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
const offlineSecrets = await OfflineSecretStore.open(resolveOfflineSecretDbPath());
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
    roomStatus?: string | undefined;
    onlineClients?: number | undefined;
    logicalClients?: number | undefined;
    pendingMessages?: number | undefined;
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
      state: meta.state,
      roomStatus: meta.roomStatus,
      onlineClients: meta.onlineClients,
      logicalClients: meta.logicalClients,
      pendingMessages: meta.pendingMessages
    },
    "ws"
  );
};

const roomLogMeta = (room: RoomState) => ({
  roomStatus: room.status,
  onlineClients: room.clients.size,
  logicalClients: room.clients.size,
  pendingMessages: room.pendingMessages.size
});

const legacyRoomPeers = (room: RoomState) =>
  [...room.clients.values()]
    .filter((client): client is ClientState & { clientId: string; publicKey: string } =>
      typeof client.clientId === "string" && typeof client.publicKey === "string"
    )
    .map((client) => ({
      clientId: client.clientId,
      publicKey: client.publicKey
    }));

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

const isLegacyPublicKey = (value: unknown) => value === undefined || isSafeToken(value, 40, 256);

const isBurnAfter = (value: unknown): value is BurnAfterMs =>
  value === 5000 || value === 10000 || value === 30000 || value === 60000;

const isOfflineUnreadTtlMs = (value: unknown) =>
  value === 3_600_000 || value === 86_400_000 || value === 604_800_000;

const isOfflineReadTtlMs = (value: unknown) =>
  value === 5000 || value === 30000 || value === 60000;

const isSafeCipherPart = (value: unknown, min: number, max: number) =>
  typeof value === "string" &&
  value.length >= min &&
  value.length <= max &&
  /^[A-Za-z0-9_-]+$/.test(value);

const isSecurityEventKind = (value: unknown) =>
  value === "screenshot" ||
  value === "screen_recording_started" ||
  value === "screen_recording_stopped" ||
  value === "screen_projection";

const isSecurityPlatform = (value: unknown) => value === "android" || value === "ios" || value === "web";

const isOfflineSecretCreateBody = (
  value: unknown
): value is {
  ciphertext: string;
  iv: string;
  aad: string;
  salt: string;
  kdfParams: string;
  unreadTtlMs: number;
  readTtlMs: number;
} =>
  isRecord(value) &&
  isSafeCipherPart(value.ciphertext, 16, maxOfflineSecretCiphertextChars) &&
  isSafeCipherPart(value.iv, 12, 64) &&
  isSafeCipherPart(value.aad, 8, 512) &&
  isSafeCipherPart(value.salt, 8, 128) &&
  typeof value.kdfParams === "string" &&
  value.kdfParams.length >= 4 &&
  value.kdfParams.length <= 512 &&
  /^[A-Za-z0-9_-]+$/.test(value.kdfParams) &&
  isOfflineUnreadTtlMs(value.unreadTtlMs) &&
  isOfflineReadTtlMs(value.readTtlMs);

const isOfflineSecretOpenBody = (value: unknown): value is { readToken: string; readTtlMs: number } =>
  isRecord(value) &&
  isSafeToken(value.readToken, 24, 96) &&
  isOfflineReadTtlMs(value.readTtlMs);

const isOfflineSecretBurnBody = (value: unknown): value is { readToken: string } =>
  isRecord(value) && isSafeToken(value.readToken, 24, 96);

const isClientCipherMessage = (value: unknown): value is ClientCipherMessage => {
  if (!isRecord(value)) return false;
  const hasValidBase =
    isSafeToken(value.messageId, 12, 96) &&
    isSafeToken(value.senderClientId, 12, 96) &&
    isSafeToken(value.iv, 12, 64) &&
    typeof value.ciphertext === "string" &&
    value.ciphertext.length > 0 &&
    value.ciphertext.length <= maxCiphertextChars &&
    /^[A-Za-z0-9_-]+$/.test(value.ciphertext) &&
    isBurnAfter(value.burnAfterMs) &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt);

  if (!hasValidBase) return false;
  if (value.roomIdHash === undefined && value.aad === undefined) return true;

  return isRoomHash(value.roomIdHash) && isSafeToken(value.aad, 16, 512);
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

const roomPendingCiphertextChars = (room: RoomState) =>
  [...room.pendingMessages.values()].reduce((total, message) => total + message.ciphertext.length, 0);

const burnStoredMessage = (
  room: RoomState,
  messageId: string,
  burnedAt: number,
  serverTime: number,
  clientId: string | undefined,
  result: "deleted" | "timer"
) => {
  room.pendingMessages.delete(messageId);
  room.burnedMessageIds.set(messageId, serverTime + burnedIdTtlMs);
  room.updatedAt = serverTime;

  broadcast(room, {
    type: "message:burn",
    messageId,
    burnedAt,
    serverTime
  });

  logWs("message:burn", {
    roomIdHash: room.roomIdHash,
    clientId,
    messageId,
    result
  });
};

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
      burnStoredMessage(room, messageId, message.burnAt, now, undefined, "timer");
    }
  }
};

const pruneDisconnectedClients = (room: RoomState) => {
  let removed = 0;
  for (const [clientId, client] of room.clients.entries()) {
    if (client.ws.readyState === WebSocket.OPEN) continue;
    room.clients.delete(clientId);
    delete client.roomIdHash;
    client.closed = true;
    clients.delete(client);
    removed += 1;
  }

  if (removed > 0) {
    room.updatedAt = Date.now();
    if (room.clients.size === 0) {
      room.status = "suspended";
      room.suspendedAt = room.updatedAt;
    } else if (room.status === "active") {
      room.status = "peer_offline";
      delete room.suspendedAt;
    }
  }

  return removed;
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
  delete client.publicKey;
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
  if (!isRoomHash(event.roomIdHash) || !isSafeToken(event.clientId, 12, 96) || !isLegacyPublicKey(event.publicKey)) {
    send(client, { type: "room:unavailable" });
    logWs("room:join", {
      roomIdHash: typeof event.roomIdHash === "string" ? event.roomIdHash : undefined,
      clientId: typeof event.clientId === "string" ? event.clientId : undefined,
      errorType: "invalid",
      result: "rejected"
    });
    return;
  }

  const risk = disableRateLimit ? { allowed: true as const } : checkJoin(client.ipRiskHash, event.roomIdHash);
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
  const prunedClients = pruneDisconnectedClients(room);
  logWs("room:join:state", {
    roomIdHash: event.roomIdHash,
    clientId: event.clientId,
    result: "before-join",
    ...(prunedClients > 0 ? { errorType: "stale-clients-pruned" } : {}),
    ...roomLogMeta(room)
  });

  if (room.destroying || room.expireAt <= now || room.clients.size >= 2) {
    send(client, { type: "room:unavailable" });
    logWs("room:join", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      result: "unavailable",
      ...roomLogMeta(room)
    });
    return;
  }

  const previousStatus = room.status;
  rooms.set(event.roomIdHash, room);

  client.clientId = event.clientId;
  delete client.publicKey;
  if (event.publicKey) {
    client.publicKey = event.publicKey;
  }
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
      result: room.status,
      ...roomLogMeta(room)
    });
    return;
  }

  room.status = "active";
  room.hadPeer = true;
  delete room.suspendedAt;
  const legacyPeers = legacyRoomPeers(room);
  const activeEvent: ServerEvent = {
    type: "room:active",
    serverTime: now,
    ...(legacyPeers.length > 0 ? { peers: legacyPeers } : {})
  };
  for (const peer of room.clients.values()) {
    send(peer, activeEvent);
    if (peer.clientId !== event.clientId) {
      send(peer, { type: "peer:reconnected", serverTime: now });
    }
  }
  sendHistory(client, room);

  logWs("room:join", {
    roomIdHash: event.roomIdHash,
    clientId: event.clientId,
    result: "active",
    ...roomLogMeta(room)
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
    !isClientCipherMessage(event.message) ||
    ("roomIdHash" in event.message && event.message.roomIdHash !== event.roomIdHash) ||
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

  const risk = disableRateLimit ? { allowed: true as const } : checkSend(client.ipRiskHash);
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
  const message: CipherMessage = {
    ...event.message,
    roomIdHash: event.roomIdHash,
    aad: "aad" in event.message ? event.message.aad : ""
  };
  const roomCiphertextChars = roomPendingCiphertextChars(room);
  const existing = room.pendingMessages.get(message.messageId);
  const existingChars = existing?.ciphertext.length ?? 0;
  if (roomCiphertextChars - existingChars + message.ciphertext.length > maxRoomPendingCiphertextChars) {
    send(client, { type: "message:failed", messageId: message.messageId, reason: "rate_limited" });
    logWs("message:send", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      messageId: message.messageId,
      result: "limited",
      errorType: "room-pending-bytes"
    });
    return;
  }
  const pending: PendingEncryptedMessage = {
    ...message,
    expireAt: Math.min(now + messageTtlMs, room.expireAt),
    state: "stored"
  };
  room.pendingMessages.set(message.messageId, pending);
  room.updatedAt = now;

  send(client, {
    type: "message:server_ack",
    messageId: message.messageId,
    state: "stored",
    serverTime: now
  });

  for (const peer of room.clients.values()) {
    if (peer.clientId !== event.clientId) {
      send(peer, { type: "message:receive", message, state: pending.state, serverTime: now });
    }
  }

  logWs("message:send", {
    roomIdHash: event.roomIdHash,
    clientId: event.clientId,
    messageId: message.messageId,
    result: room.clients.size > 1 ? "forwarded" : "stored",
    state: pending.state,
    ...roomLogMeta(room)
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
  if (
    !isRoomHash(event.roomIdHash) ||
    !isSafeToken(event.clientId, 12, 96) ||
    !isSafeToken(event.messageId, 12, 96) ||
    event.confirm !== "user-click"
  ) {
    sendError(client);
    logWs("message:seen", {
      roomIdHash: typeof event.roomIdHash === "string" ? event.roomIdHash : undefined,
      clientId: typeof event.clientId === "string" ? event.clientId : undefined,
      messageId: typeof event.messageId === "string" ? event.messageId : undefined,
      errorType: "invalid",
      result: "rejected"
    });
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

  const seenAt = Date.now();
  message.state = "burning";
  message.seenAt = seenAt;
  message.burnAt = seenAt + message.burnAfterMs;
  room.updatedAt = seenAt;

  broadcast(room, {
    type: "message:seen",
    messageId: event.messageId,
    seenBy: event.clientId,
    seenAt,
    burnAt: message.burnAt,
    serverTime: seenAt
  });

  logWs("message:seen", {
    roomIdHash: event.roomIdHash,
    clientId: event.clientId,
    messageId: event.messageId,
    result: "broadcast",
    state: message.state
  });

  const burnAt = message.burnAt;
  const burnTimer = setTimeout(() => {
    const currentRoom = rooms.get(event.roomIdHash);
    const currentMessage = currentRoom?.pendingMessages.get(event.messageId);
    if (!currentRoom || !currentMessage || currentMessage.state !== "burning" || currentMessage.burnAt !== burnAt) return;
    burnStoredMessage(currentRoom, event.messageId, burnAt, Date.now(), event.clientId, "timer");
  }, Math.max(0, burnAt - Date.now()));
  burnTimer.unref();
};

const handleBurn = (client: ClientState, event: Extract<ClientEvent, { type: "message:burn" }>) => {
  if (!isRoomHash(event.roomIdHash) || !isSafeToken(event.clientId, 12, 96) || !isSafeToken(event.messageId, 12, 96)) {
    sendError(client);
    return;
  }

  const room = getJoinedRoom(client, event.roomIdHash, event.clientId);
  if (!room) return;
  const message = room.pendingMessages.get(event.messageId);
  const now = Date.now();

  if (!message || message.state !== "burning" || typeof message.burnAt !== "number" || message.burnAt > now) {
    logWs("message:burn", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      messageId: event.messageId,
      result: "ignored",
      state: message?.state
    });
    return;
  }

  burnStoredMessage(room, event.messageId, message.burnAt, now, event.clientId, "deleted");
};

const handleSecurityEvent = (client: ClientState, event: Extract<ClientEvent, { type: "security:event" }>) => {
  if (
    !isRoomHash(event.roomIdHash) ||
    !isSafeToken(event.clientId, 12, 96) ||
    !isSecurityEventKind(event.kind) ||
    !isSecurityPlatform(event.platform) ||
    typeof event.blocked !== "boolean" ||
    typeof event.detectedAt !== "number" ||
    !Number.isFinite(event.detectedAt)
  ) {
    sendError(client);
    return;
  }

  const room = getJoinedRoom(client, event.roomIdHash, event.clientId);
  if (!room) return;
  const serverTime = Date.now();
  broadcast(room, {
    type: "security:event",
    kind: event.kind,
    platform: event.platform,
    blocked: event.blocked,
    detectedAt: event.detectedAt,
    byClientId: event.clientId,
    serverTime
  });
  logWs("security:event", {
    roomIdHash: event.roomIdHash,
    clientId: event.clientId,
    result: event.blocked ? "blocked" : "detected",
    errorType: `${event.platform}:${event.kind}`
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

  if (Buffer.byteLength(text, "utf8") > maxClientEventBytes) return undefined;
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
      case "security:event":
        handleSecurityEvent(client, event);
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

  offlineSecrets.cleanupExpired(now);
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

app.post("/api/offline-secrets", async (request, reply) => {
  if (!isOfflineSecretCreateBody(request.body)) {
    return reply.code(400).send({ error: "invalid" });
  }

  const created = offlineSecrets.create(request.body);
  return reply.send(created);
});

app.get("/api/offline-secrets/:secretId/meta", async (request, reply) => {
  const params = request.params;
  const secretId = isRecord(params) && typeof params.secretId === "string" ? params.secretId : "";
  const meta = offlineSecrets.getMeta(secretId);
  if (!meta || meta.status === "expired" || meta.status === "burned") {
    return reply.code(404).send({ error: "not_found" });
  }
  return reply.send(meta);
});

app.post("/api/offline-secrets/:secretId/open", async (request, reply) => {
  const params = request.params;
  const secretId = isRecord(params) && typeof params.secretId === "string" ? params.secretId : "";
  if (!isOfflineSecretOpenBody(request.body)) {
    return reply.code(400).send({ error: "invalid" });
  }

  const opened = offlineSecrets.openSecret(secretId, request.body.readToken, request.body.readTtlMs);
  if (!opened) {
    return reply.code(404).send({ error: "not_found" });
  }
  return reply.send(opened);
});

app.post("/api/offline-secrets/:secretId/burn", async (request, reply) => {
  const params = request.params;
  const secretId = isRecord(params) && typeof params.secretId === "string" ? params.secretId : "";
  if (!isOfflineSecretBurnBody(request.body)) {
    return reply.code(400).send({ error: "invalid" });
  }
  if (!offlineSecrets.burnWithToken(secretId, request.body.readToken)) {
    return reply.code(404).send({ error: "not_found" });
  }
  return reply.send({ ok: true });
});

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
