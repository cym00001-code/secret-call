import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

const wsUrl = "ws://127.0.0.1:3101/ws";

const createRoomHash = () => createHash("sha256").update(`legacy-${Date.now()}-${randomBytes(8).toString("hex")}`).digest("hex");
const token = (prefix: string) => `${prefix}_${randomBytes(18).toString("base64url")}`;
const publicKey = () => randomBytes(65).toString("base64url");

const waitForOpen = (socket: WebSocket) =>
  new Promise<void>((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket failed to open")), { once: true });
  });

const waitForEvent = <T extends { type: string }>(socket: WebSocket, type: T["type"], timeoutMs = 10_000) =>
  new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs);
    socket.addEventListener("message", (message) => {
      const parsed = JSON.parse(String(message.data)) as T;
      if (parsed.type === type) {
        clearTimeout(timeout);
        resolve(parsed);
      }
    });
  });

test("legacy room:active event includes peers for cached ECDH clients", async () => {
  const roomIdHash = createRoomHash();
  const clientA = { clientId: token("client"), publicKey: publicKey() };
  const clientB = { clientId: token("client"), publicKey: publicKey() };
  const socketA = new WebSocket(wsUrl);
  const socketB = new WebSocket(wsUrl);

  try {
    await waitForOpen(socketA);
    socketA.send(JSON.stringify({ type: "room:join", roomIdHash, ...clientA }));
    await waitForEvent(socketA, "room:waiting");

    const activeA = waitForEvent<{ type: "room:active"; peers?: typeof clientA[] }>(socketA, "room:active");
    const activeB = waitForEvent<{ type: "room:active"; peers?: typeof clientA[] }>(socketB, "room:active");

    await waitForOpen(socketB);
    socketB.send(JSON.stringify({ type: "room:join", roomIdHash, ...clientB }));

    await expect(activeA).resolves.toMatchObject({
      type: "room:active",
      peers: expect.arrayContaining([clientA, clientB])
    });
    await expect(activeB).resolves.toMatchObject({
      type: "room:active",
      peers: expect.arrayContaining([clientA, clientB])
    });
  } finally {
    socketA.close();
    socketB.close();
  }
});

test("presence update broadcasts peer platforms without requiring legacy public keys", async () => {
  const roomIdHash = createRoomHash();
  const clientA = { clientId: token("client"), platform: "web" };
  const clientB = { clientId: token("client"), platform: "ios" };
  const socketA = new WebSocket(wsUrl);
  const socketB = new WebSocket(wsUrl);

  try {
    await waitForOpen(socketA);
    socketA.send(JSON.stringify({ type: "room:join", roomIdHash, ...clientA }));
    await waitForEvent(socketA, "room:waiting");

    const presenceA = waitForEvent<{
      type: "presence:update";
      peers: Array<{ clientId: string; platform: string; openedAt: number; lastSeenAt: number }>;
    }>(socketA, "presence:update");
    const presenceB = waitForEvent<{
      type: "presence:update";
      peers: Array<{ clientId: string; platform: string; openedAt: number; lastSeenAt: number }>;
    }>(socketB, "presence:update");

    await waitForOpen(socketB);
    socketB.send(JSON.stringify({ type: "room:join", roomIdHash, ...clientB }));

    await expect(presenceA).resolves.toMatchObject({
      type: "presence:update",
      peers: expect.arrayContaining([
        expect.objectContaining(clientA),
        expect.objectContaining(clientB)
      ])
    });
    await expect(presenceB).resolves.toMatchObject({
      type: "presence:update",
      peers: expect.arrayContaining([
        expect.objectContaining(clientA),
        expect.objectContaining(clientB)
      ])
    });
  } finally {
    socketA.close();
    socketB.close();
  }
});

test("legacy ciphertext can be forwarded between cached ECDH clients", async () => {
  const roomIdHash = createRoomHash();
  const clientA = { clientId: token("client"), publicKey: publicKey() };
  const clientB = { clientId: token("client"), publicKey: publicKey() };
  const message = {
    messageId: token("msg"),
    senderClientId: clientA.clientId,
    iv: randomBytes(12).toString("base64url"),
    ciphertext: randomBytes(48).toString("base64url"),
    burnAfterMs: 30000 as const,
    createdAt: Date.now()
  };
  const socketA = new WebSocket(wsUrl);
  const socketB = new WebSocket(wsUrl);

  try {
    await waitForOpen(socketA);
    socketA.send(JSON.stringify({ type: "room:join", roomIdHash, ...clientA }));
    await waitForEvent(socketA, "room:waiting");

    await waitForOpen(socketB);
    const receiveB = waitForEvent<{ type: "message:receive"; message: typeof message & { roomIdHash: string }; state: string }>(
      socketB,
      "message:receive"
    );
    socketB.send(JSON.stringify({ type: "room:join", roomIdHash, ...clientB }));
    await waitForEvent(socketB, "room:active");

    socketA.send(JSON.stringify({ type: "message:send", roomIdHash, clientId: clientA.clientId, message }));

    await expect(receiveB).resolves.toMatchObject({
      type: "message:receive",
      state: "stored",
      message: {
        ...message,
        roomIdHash,
        aad: ""
      }
    });
  } finally {
    socketA.close();
    socketB.close();
  }
});

test("seen without an explicit user click token cannot start burn countdown", async () => {
  const roomIdHash = createRoomHash();
  const clientA = { clientId: token("client"), publicKey: publicKey() };
  const clientB = { clientId: token("client"), publicKey: publicKey() };
  const message = {
    messageId: token("msg"),
    senderClientId: clientA.clientId,
    iv: randomBytes(12).toString("base64url"),
    ciphertext: randomBytes(48).toString("base64url"),
    burnAfterMs: 30000 as const,
    createdAt: Date.now()
  };
  const socketA = new WebSocket(wsUrl);
  const socketB = new WebSocket(wsUrl);

  try {
    await waitForOpen(socketA);
    socketA.send(JSON.stringify({ type: "room:join", roomIdHash, ...clientA }));
    await waitForEvent(socketA, "room:waiting");

    await waitForOpen(socketB);
    socketB.send(JSON.stringify({ type: "room:join", roomIdHash, ...clientB }));
    await waitForEvent(socketB, "room:active");

    socketA.send(JSON.stringify({ type: "message:send", roomIdHash, clientId: clientA.clientId, message }));
    await waitForEvent(socketB, "message:receive");

    socketB.send(
      JSON.stringify({
        type: "message:visible",
        roomIdHash,
        clientId: clientB.clientId,
        messageId: message.messageId,
        at: Date.now()
      })
    );
    await waitForEvent(socketA, "message:visible");

    const burnA = waitForEvent(socketA, "message:seen");
    socketB.send(
      JSON.stringify({
        type: "message:seen",
        roomIdHash,
        clientId: clientB.clientId,
        messageId: message.messageId
      })
    );

    await expect(burnA).rejects.toThrow("Timed out waiting for message:seen");
  } finally {
    socketA.close();
    socketB.close();
  }
});

test("direct burn cannot delete a message before the click-started countdown expires", async () => {
  const roomIdHash = createRoomHash();
  const clientA = { clientId: token("client"), publicKey: publicKey() };
  const clientB = { clientId: token("client"), publicKey: publicKey() };
  const message = {
    messageId: token("msg"),
    senderClientId: clientA.clientId,
    iv: randomBytes(12).toString("base64url"),
    ciphertext: randomBytes(48).toString("base64url"),
    burnAfterMs: 5000 as const,
    createdAt: Date.now()
  };
  const socketA = new WebSocket(wsUrl);
  const socketB = new WebSocket(wsUrl);

  try {
    await waitForOpen(socketA);
    socketA.send(JSON.stringify({ type: "room:join", roomIdHash, ...clientA }));
    await waitForEvent(socketA, "room:waiting");

    await waitForOpen(socketB);
    socketB.send(JSON.stringify({ type: "room:join", roomIdHash, ...clientB }));
    await waitForEvent(socketB, "room:active");

    socketA.send(JSON.stringify({ type: "message:send", roomIdHash, clientId: clientA.clientId, message }));
    await waitForEvent(socketB, "message:receive");

    const prematureBurnA = waitForEvent(socketA, "message:burn", 1000);
    socketB.send(
      JSON.stringify({
        type: "message:burn",
        roomIdHash,
        clientId: clientB.clientId,
        messageId: message.messageId,
        burnedAt: Date.now()
      })
    );
    await expect(prematureBurnA).rejects.toThrow("Timed out waiting for message:burn");

    socketB.send(JSON.stringify({ type: "room:sync", roomIdHash, clientId: clientB.clientId }));
    const history = await waitForEvent<{ type: "message:history"; messages: Array<{ messageId: string }> }>(
      socketB,
      "message:history"
    );
    expect(history.messages).toEqual(expect.arrayContaining([expect.objectContaining({ messageId: message.messageId })]));

    socketB.send(
      JSON.stringify({
        type: "message:visible",
        roomIdHash,
        clientId: clientB.clientId,
        messageId: message.messageId,
        at: Date.now()
      })
    );
    await waitForEvent(socketA, "message:visible");

    socketB.send(
      JSON.stringify({
        type: "message:seen",
        roomIdHash,
        clientId: clientB.clientId,
        messageId: message.messageId,
        confirm: "user-click"
      })
    );
    const seen = await waitForEvent<{ type: "message:seen"; seenAt: number; burnAt: number; serverTime: number }>(
      socketA,
      "message:seen"
    );
    expect(seen.serverTime).toBe(seen.seenAt);
    expect(seen.burnAt - seen.seenAt).toBe(message.burnAfterMs);

    socketB.send(JSON.stringify({ type: "room:sync", roomIdHash, clientId: clientB.clientId }));
    const burningHistory = await waitForEvent<{
      type: "message:history";
      messages: Array<{ messageId: string; seenAt?: number; burnAt?: number; state: string }>;
    }>(socketB, "message:history");
    expect(burningHistory.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageId: message.messageId,
          state: "burning",
          seenAt: seen.seenAt,
          burnAt: seen.burnAt
        })
      ])
    );

    const earlyBurnA = waitForEvent(socketA, "message:burn", 1000);
    socketB.send(
      JSON.stringify({
        type: "message:burn",
        roomIdHash,
        clientId: clientB.clientId,
        messageId: message.messageId,
        burnedAt: Date.now()
      })
    );
    await expect(earlyBurnA).rejects.toThrow("Timed out waiting for message:burn");

    await expect(waitForEvent(socketA, "message:burn")).resolves.toMatchObject({
      type: "message:burn",
      messageId: message.messageId,
      burnedAt: seen.burnAt
    });
  } finally {
    socketA.close();
    socketB.close();
  }
});
