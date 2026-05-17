import { randomBytes } from "node:crypto";
import { URL } from "node:url";
import fastify from "fastify";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import {
  type CipherMessage,
  type ClientEvent,
  type ServerEvent,
  getEventType,
  isRecord
} from "./protocol.js";
import { checkJoin, checkSend, createIpRiskHash } from "./rateLimit.js";

interface Client {
  ws: WebSocket;
  ipRiskHash: string;
  clientId?: string;
  publicKey?: string;
  roomIdHash?: string;
  joinedAt: number;
  lastSeenAt: number;
  closed: boolean;
}

interface Room {
  roomIdHash: string;
  clients: Map<string, Client>;
  createdAt: number;
  lastActivityAt: number;
  active: boolean;
  destroying: boolean;
}

const port = Number.parseInt(process.env.PORT ?? "3101", 10);
const host = process.env.HOST ?? "0.0.0.0";
const roomTtlMs = Number.parseInt(process.env.ROOM_TTL_MS ?? "1800000", 10);
const roomIdleTtlMs = Number.parseInt(process.env.ROOM_IDLE_TTL_MS ?? "600000", 10);
const clientTimeoutMs = Number.parseInt(process.env.CLIENT_TIMEOUT_MS ?? "35000", 10);
const ipHashSecret =
  process.env.IP_HASH_SECRET && process.env.IP_HASH_SECRET.length >= 32
    ? process.env.IP_HASH_SECRET
    : randomBytes(32).toString("hex");

const app = fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie"],
      censor: "[redacted]"
    }
  }
});

const wss = new WebSocketServer({ noServer: true });
const rooms = new Map<string, Room>();
const clients = new Set<Client>();

const short = (value: string | undefined) => (value ? value.slice(0, 8) : undefined);

const logWs = (
  event: string,
  meta: {
    roomIdHash?: string | undefined;
    clientId?: string | undefined;
    errorType?: string | undefined;
    risk?: string | undefined;
    result?: string | undefined;
  } = {}
) => {
  app.log.info(
    {
      event,
      room: short(meta.roomIdHash),
      client: short(meta.clientId),
      errorType: meta.errorType,
      risk: meta.risk,
      result: meta.result
    },
    "ws"
  );
};

const send = (client: Client, event: ServerEvent) => {
  if (client.ws.readyState !== client.ws.OPEN) return;
  client.ws.send(JSON.stringify(event));
};

const sendError = (client: Client, message = "房间暂不可用") => {
  send(client, { type: "error", message });
};

const normalizeIp = (request: Parameters<typeof wss.emit>[1]) => {
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

const isBurnAfter = (value: unknown): value is CipherMessage["burnAfterMs"] =>
  value === 5000 || value === 10000 || value === 30000 || value === 60000;

const isCipherMessage = (value: unknown): value is CipherMessage => {
  if (!isRecord(value)) return false;
  return (
    isSafeToken(value.messageId, 12, 96) &&
    isSafeToken(value.senderClientId, 12, 96) &&
    isSafeToken(value.iv, 12, 64) &&
    typeof value.ciphertext === "string" &&
    value.ciphertext.length > 0 &&
    value.ciphertext.length <= 16_384 &&
    isBurnAfter(value.burnAfterMs) &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt)
  );
};

const roomPeers = (room: Room) =>
  [...room.clients.values()].map((client) => ({
    clientId: client.clientId ?? "",
    publicKey: client.publicKey ?? ""
  }));

const destroyRoom = (room: Room, reason: string) => {
  if (room.destroying) return;
  room.destroying = true;
  rooms.delete(room.roomIdHash);

  for (const client of room.clients.values()) {
    delete client.roomIdHash;
    send(client, { type: "room:destroyed" });
    if (client.ws.readyState === client.ws.OPEN) {
      client.ws.close(1000, "room destroyed");
    }
  }

  logWs("room:destroyed", {
    roomIdHash: room.roomIdHash,
    errorType: reason,
    result: "deleted"
  });
};

const cleanupClient = (client: Client, reason: string) => {
  if (client.closed) return;
  client.closed = true;
  clients.delete(client);

  const roomIdHash = client.roomIdHash;
  const clientId = client.clientId;
  if (!roomIdHash || !clientId) {
    logWs("client:close", { clientId, errorType: reason });
    return;
  }

  const room = rooms.get(roomIdHash);
  if (!room) {
    logWs("client:close", { roomIdHash, clientId, errorType: reason });
    return;
  }

  room.clients.delete(clientId);
  room.lastActivityAt = Date.now();

  if (room.clients.size === 0) {
    rooms.delete(roomIdHash);
    logWs("room:destroyed", {
      roomIdHash,
      clientId,
      errorType: "empty",
      result: "deleted"
    });
    return;
  }

  if (room.active) {
    for (const remaining of room.clients.values()) {
      send(remaining, { type: "peer:left" });
    }
    destroyRoom(room, "peer-left");
    return;
  }

  for (const remaining of room.clients.values()) {
    send(remaining, { type: "peer:left" });
  }

  logWs("client:close", { roomIdHash, clientId, errorType: reason });
};

const handleJoin = (client: Client, event: Extract<ClientEvent, { type: "room:join" }>) => {
  if (!isRoomHash(event.roomIdHash) || !isSafeToken(event.clientId, 12, 96) || !isSafeToken(event.publicKey, 40, 256)) {
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
    sendError(client, "连接过于频繁，请稍后再试");
    logWs("room:join", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      risk: risk.reason,
      result: "limited"
    });
    return;
  }

  const existing = rooms.get(event.roomIdHash);
  if (existing && (existing.destroying || existing.clients.size >= 2)) {
    send(client, { type: "room:unavailable" });
    logWs("room:join", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      result: "unavailable"
    });
    return;
  }

  const room =
    existing ??
    {
      roomIdHash: event.roomIdHash,
      clients: new Map<string, Client>(),
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      active: false,
      destroying: false
    };

  rooms.set(event.roomIdHash, room);
  client.clientId = event.clientId;
  client.publicKey = event.publicKey;
  client.roomIdHash = event.roomIdHash;
  client.joinedAt = Date.now();
  client.lastSeenAt = Date.now();
  client.closed = false;
  room.clients.set(event.clientId, client);
  room.lastActivityAt = Date.now();

  if (room.clients.size === 1) {
    send(client, { type: "room:waiting" });
    logWs("room:join", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      result: "waiting"
    });
    return;
  }

  room.active = true;
  const activeEvent: ServerEvent = {
    type: "room:active",
    peers: roomPeers(room),
    serverTime: Date.now()
  };

  for (const peer of room.clients.values()) {
    send(peer, activeEvent);
  }

  logWs("room:join", {
    roomIdHash: event.roomIdHash,
    clientId: event.clientId,
    result: "active"
  });
};

const getJoinedRoom = (client: Client, roomIdHash: string, clientId: string) => {
  if (client.roomIdHash !== roomIdHash || client.clientId !== clientId) {
    return undefined;
  }
  const room = rooms.get(roomIdHash);
  if (!room || !room.clients.has(clientId)) {
    return undefined;
  }
  return room;
};

const handleSend = (client: Client, event: Extract<ClientEvent, { type: "message:send" }>) => {
  if (!isRoomHash(event.roomIdHash) || !isSafeToken(event.clientId, 12, 96) || !isCipherMessage(event.message)) {
    sendError(client);
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
    sendError(client, "连接过于频繁，请稍后再试");
    logWs("message:send", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      risk: risk.reason,
      result: "limited"
    });
    return;
  }

  const room = getJoinedRoom(client, event.roomIdHash, event.clientId);
  if (!room || !room.active) {
    send(client, { type: "room:unavailable" });
    logWs("message:send", {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      errorType: "room",
      result: "rejected"
    });
    return;
  }

  room.lastActivityAt = Date.now();
  for (const peer of room.clients.values()) {
    if (peer.clientId !== event.clientId) {
      send(peer, { type: "message:receive", message: event.message });
    }
  }

  logWs("message:send", {
    roomIdHash: event.roomIdHash,
    clientId: event.clientId,
    result: "forwarded"
  });
};

const broadcastRoomEvent = (
  client: Client,
  event:
    | Extract<ClientEvent, { type: "message:seen" }>
    | Extract<ClientEvent, { type: "message:burn" }>
) => {
  if (!isRoomHash(event.roomIdHash) || !isSafeToken(event.clientId, 12, 96) || !isSafeToken(event.messageId, 12, 96)) {
    sendError(client);
    logWs(event.type, {
      roomIdHash: typeof event.roomIdHash === "string" ? event.roomIdHash : undefined,
      clientId: typeof event.clientId === "string" ? event.clientId : undefined,
      errorType: "invalid",
      result: "rejected"
    });
    return;
  }

  const room = getJoinedRoom(client, event.roomIdHash, event.clientId);
  if (!room) {
    send(client, { type: "room:unavailable" });
    logWs(event.type, {
      roomIdHash: event.roomIdHash,
      clientId: event.clientId,
      errorType: "room",
      result: "rejected"
    });
    return;
  }

  room.lastActivityAt = Date.now();
  const serverEvent: ServerEvent =
    event.type === "message:seen"
      ? {
          type: "message:seen",
          messageId: event.messageId,
          seenBy: event.clientId,
          seenAt: Number.isFinite(event.seenAt) ? event.seenAt : Date.now()
        }
      : {
          type: "message:burn",
          messageId: event.messageId,
          burnedAt: Number.isFinite(event.burnedAt) ? event.burnedAt : Date.now()
        };

  for (const peer of room.clients.values()) {
    send(peer, serverEvent);
  }

  logWs(event.type, {
    roomIdHash: event.roomIdHash,
    clientId: event.clientId,
    result: "broadcast"
  });
};

const handleDestroy = (client: Client, event: Extract<ClientEvent, { type: "room:destroy" }>) => {
  if (!isRoomHash(event.roomIdHash) || !isSafeToken(event.clientId, 12, 96)) {
    send(client, { type: "room:unavailable" });
    return;
  }

  const room = getJoinedRoom(client, event.roomIdHash, event.clientId);
  if (!room) {
    send(client, { type: "room:unavailable" });
    return;
  }

  destroyRoom(room, "requested");
};

const parseClientEvent = (data: RawData): ClientEvent | undefined => {
  const text = Array.isArray(data)
    ? Buffer.concat(data).toString("utf8")
    : Buffer.isBuffer(data)
      ? data.toString("utf8")
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString("utf8")
        : Buffer.from(data).toString("utf8");

  if (Buffer.byteLength(text, "utf8") > 20_000) return undefined;
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
  const client: Client = {
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
      case "message:send":
        handleSend(client, event);
        break;
      case "message:seen":
      case "message:burn":
        broadcastRoomEvent(client, event);
        break;
      case "room:destroy":
        handleDestroy(client, event);
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
    if (now - room.createdAt > roomTtlMs || now - room.lastActivityAt > roomIdleTtlMs) {
      destroyRoom(room, "ttl");
    }
  }
}, 10_000).unref();

app.get("/health", async () => ({
  ok: true,
  rooms: rooms.size,
  clients: clients.size
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

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

await app.listen({ port, host });
app.log.info({ port, host }, "secret-room server listening");
