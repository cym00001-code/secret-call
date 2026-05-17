"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decryptText,
  deriveRoomSecrets,
  deriveSessionMaterial,
  encryptText,
  generateEcdhMaterial,
  randomToken
} from "@/lib/crypto";
import type {
  BurnAfterMs,
  ClientEvent,
  LocalMessage,
  RoomState,
  ServerEvent
} from "@/types/protocol";

interface PendingMaterial {
  roomIdHash: string;
  psk: ArrayBuffer;
  clientId: string;
  privateKey: CryptoKey;
  publicKey: string;
}

interface ActiveMaterial extends PendingMaterial {
  sessionKey: CryptoKey;
  securityCode: string;
  transcriptHash: string;
}

interface JoinInput {
  roomNumber: string;
  passphrase: string;
}

const isServerEvent = (value: unknown): value is ServerEvent =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

const resolveWsUrl = () => {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:3101/ws`;
  }
  return `${protocol}//${window.location.host}/ws`;
};

export const useSecretRoom = () => {
  const [roomState, setRoomState] = useState<RoomState>("idle");
  const [roomNumber, setRoomNumber] = useState("");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [selectedBurnTime, setSelectedBurnTime] = useState<BurnAfterMs>(30000);
  const [securityCode, setSecurityCode] = useState("");
  const [statusText, setStatusText] = useState("");
  const [isBlurred, setIsBlurred] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<PendingMaterial | null>(null);
  const activeRef = useRef<ActiveMaterial | null>(null);
  const burnTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const manualCloseRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearBurnTimers = useCallback(() => {
    for (const timer of burnTimersRef.current.values()) {
      clearTimeout(timer);
    }
    burnTimersRef.current.clear();
  }, []);

  const wipeLocalSession = useCallback(() => {
    clearBurnTimers();
    pendingRef.current = null;
    activeRef.current = null;
    setMessages([]);
    setSecurityCode("");
  }, [clearBurnTimers]);

  const closeSocket = useCallback(() => {
    manualCloseRef.current = true;
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close(1000, "local close");
    }
    wsRef.current = null;
  }, []);

  const sendEvent = useCallback((event: ClientEvent) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(event));
    return true;
  }, []);

  const scheduleBurn = useCallback(
    (messageId: string, burnAfterMs: BurnAfterMs, seenAt: number) => {
      const existing = burnTimersRef.current.get(messageId);
      if (existing) clearTimeout(existing);

      const expireAt = seenAt + burnAfterMs;
      const delay = Math.max(0, expireAt - Date.now());
      const timer = setTimeout(() => {
        const active = activeRef.current;
        if (active) {
          sendEvent({
            type: "message:burn",
            roomIdHash: active.roomIdHash,
            clientId: active.clientId,
            messageId,
            burnedAt: Date.now()
          });
        }
        burnTimersRef.current.delete(messageId);
        setMessages((current) => current.filter((message) => message.id !== messageId));
      }, delay);

      burnTimersRef.current.set(messageId, timer);
    },
    [sendEvent]
  );

  const markMessageSeen = useCallback(
    (messageId: string, seenAt: number) => {
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== messageId || message.status === "burning") return message;
          scheduleBurn(message.id, message.burnAfterMs, seenAt);
          return {
            ...message,
            status: "burning",
            seenAt,
            expireAt: seenAt + message.burnAfterMs
          };
        })
      );
    },
    [scheduleBurn]
  );

  const removeBurnedMessage = useCallback((messageId: string) => {
    const timer = burnTimersRef.current.get(messageId);
    if (timer) clearTimeout(timer);
    burnTimersRef.current.delete(messageId);
    setMessages((current) => current.filter((message) => message.id !== messageId));
  }, []);

  const handleActive = useCallback(
    async (event: Extract<ServerEvent, { type: "room:active" }>) => {
      const pending = pendingRef.current;
      if (!pending) return;
      const peer = event.peers.find((item) => item.clientId !== pending.clientId);
      if (!peer) {
        setRoomState("waiting");
        return;
      }

      const session = await deriveSessionMaterial(
        pending.privateKey,
        pending.psk,
        pending.roomIdHash,
        pending.publicKey,
        peer.publicKey
      );

      activeRef.current = {
        ...pending,
        ...session
      };
      setSecurityCode(session.securityCode);
      setStatusText("房间已唤醒");
      setRoomState("active");
    },
    []
  );

  const handleReceive = useCallback(
    async (event: Extract<ServerEvent, { type: "message:receive" }>) => {
      const active = activeRef.current;
      if (!active || event.message.senderClientId === active.clientId) return;

      try {
        const text = await decryptText(active.sessionKey, active.roomIdHash, event.message);
        setMessages((current) => {
          if (current.some((message) => message.id === event.message.messageId)) return current;
          return [
            ...current,
            {
              id: event.message.messageId,
              from: "peer",
              text,
              burnAfterMs: event.message.burnAfterMs,
              createdAt: event.message.createdAt,
              status: "visible"
            }
          ];
        });

        sendEvent({
          type: "message:seen",
          roomIdHash: active.roomIdHash,
          clientId: active.clientId,
          messageId: event.message.messageId,
          seenAt: Date.now()
        });
      } catch {
        setStatusText("收到一条无法解密的消息");
      }
    },
    [sendEvent]
  );

  const handleServerEvent = useCallback(
    async (event: ServerEvent) => {
      switch (event.type) {
        case "room:waiting":
          setStatusText("等待另一端唤醒房间");
          setRoomState("waiting");
          break;
        case "room:active":
          await handleActive(event);
          break;
        case "room:unavailable":
          wipeLocalSession();
          closeSocket();
          setStatusText("房间暂不可用");
          setRoomState("unavailable");
          break;
        case "message:receive":
          await handleReceive(event);
          break;
        case "message:seen":
          markMessageSeen(event.messageId, event.seenAt);
          break;
        case "message:burn":
          removeBurnedMessage(event.messageId);
          break;
        case "peer:left":
          setStatusText("会话已结束");
          break;
        case "room:destroyed":
          wipeLocalSession();
          closeSocket();
          setStatusText("会话已销毁");
          setRoomState("destroyed");
          break;
        case "error":
          setStatusText(event.message);
          if (event.message.includes("频繁")) {
            setRoomState("unavailable");
          }
          break;
        case "pong":
          break;
      }
    },
    [closeSocket, handleActive, handleReceive, markMessageSeen, removeBurnedMessage, wipeLocalSession]
  );

  const joinRoom = useCallback(
    async ({ roomNumber: nextRoomNumber, passphrase }: JoinInput) => {
      const cleanRoom = nextRoomNumber.trim();
      const cleanPassphrase = passphrase.trim();
      if (!cleanRoom || !cleanPassphrase || roomState === "joining") return;

      wipeLocalSession();
      closeSocket();
      manualCloseRef.current = false;
      setRoomNumber(cleanRoom);
      setStatusText("正在唤醒房间");
      setRoomState("joining");

      try {
        const [roomSecrets, ecdh] = await Promise.all([
          deriveRoomSecrets(cleanRoom, cleanPassphrase),
          generateEcdhMaterial()
        ]);
        const clientId = randomToken("client");
        pendingRef.current = {
          ...roomSecrets,
          ...ecdh,
          clientId
        };

        const socket = new WebSocket(resolveWsUrl());
        wsRef.current = socket;

        socket.addEventListener("open", () => {
          const pending = pendingRef.current;
          if (!pending) return;
          sendEvent({
            type: "room:join",
            roomIdHash: pending.roomIdHash,
            clientId: pending.clientId,
            publicKey: pending.publicKey
          });
          heartbeatRef.current = setInterval(() => {
            sendEvent({ type: "ping", clientId: pending.clientId, sentAt: Date.now() });
          }, 15_000);
        });

        socket.addEventListener("message", (message) => {
          try {
            const parsed: unknown = JSON.parse(String(message.data));
            if (isServerEvent(parsed)) {
              void handleServerEvent(parsed);
            }
          } catch {
            setStatusText("房间暂不可用");
          }
        });

        socket.addEventListener("close", () => {
          if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
          }
          if (!manualCloseRef.current && roomState !== "idle") {
            wipeLocalSession();
            setStatusText("连接已断开");
            setRoomState("destroyed");
          }
        });

        socket.addEventListener("error", () => {
          wipeLocalSession();
          setStatusText("房间暂不可用");
          setRoomState("unavailable");
        });
      } catch {
        wipeLocalSession();
        setStatusText("房间暂不可用");
        setRoomState("unavailable");
      }
    },
    [closeSocket, handleServerEvent, roomState, sendEvent, wipeLocalSession]
  );

  const sendTextMessage = useCallback(
    async (text: string) => {
      const cleanText = text.trim();
      const active = activeRef.current;
      if (!cleanText || !active || roomState !== "active") return false;

      try {
        const encrypted = await encryptText(
          active.sessionKey,
          active.roomIdHash,
          active.clientId,
          cleanText,
          selectedBurnTime
        );
        setMessages((current) => [
          ...current,
          {
            id: encrypted.messageId,
            from: "me",
            text: cleanText,
            burnAfterMs: encrypted.burnAfterMs,
            createdAt: encrypted.createdAt,
            status: "pending"
          }
        ]);
        sendEvent({
          type: "message:send",
          roomIdHash: active.roomIdHash,
          clientId: active.clientId,
          message: encrypted
        });
        return true;
      } catch {
        setStatusText("消息发送失败");
        return false;
      }
    },
    [roomState, selectedBurnTime, sendEvent]
  );

  const destroyRoom = useCallback(() => {
    const active = activeRef.current ?? pendingRef.current;
    if (active) {
      sendEvent({
        type: "room:destroy",
        roomIdHash: active.roomIdHash,
        clientId: active.clientId
      });
    }
    wipeLocalSession();
    closeSocket();
    setStatusText("会话已销毁");
    setRoomState("destroyed");
  }, [closeSocket, sendEvent, wipeLocalSession]);

  const reset = useCallback(() => {
    wipeLocalSession();
    closeSocket();
    setRoomNumber("");
    setStatusText("");
    setIsBlurred(false);
    setRoomState("idle");
  }, [closeSocket, wipeLocalSession]);

  const hideWindow = useCallback(() => {
    if (roomState === "active") setRoomState("hidden");
  }, [roomState]);

  const revealWindow = useCallback(() => {
    if (roomState === "hidden") setRoomState("active");
  }, [roomState]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const blur = () => setIsBlurred(true);
    const focus = () => setIsBlurred(false);
    const visibility = () => {
      if (document.hidden) setIsBlurred(true);
      else setIsBlurred(false);
    };

    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);

    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(
    () => () => {
      wipeLocalSession();
      closeSocket();
    },
    [closeSocket, wipeLocalSession]
  );

  return useMemo(
    () => ({
      roomState,
      roomNumber,
      messages,
      selectedBurnTime,
      securityCode,
      statusText,
      isBlurred,
      now,
      joinRoom,
      sendTextMessage,
      setSelectedBurnTime,
      destroyRoom,
      reset,
      hideWindow,
      revealWindow
    }),
    [
      destroyRoom,
      hideWindow,
      isBlurred,
      joinRoom,
      messages,
      now,
      reset,
      revealWindow,
      roomNumber,
      roomState,
      securityCode,
      selectedBurnTime,
      sendTextMessage,
      statusText
    ]
  );
};
