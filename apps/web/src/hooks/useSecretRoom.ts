"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decryptText, deriveRoomMaterial, encryptText, randomToken } from "@/lib/crypto";
import type {
  BurnAfterMs,
  CipherMessage,
  ClientEvent,
  HistoryMessage,
  LocalMessage,
  LocalMessageStatus,
  RoomState,
  ServerEvent
} from "@/types/protocol";

interface ActiveMaterial {
  roomIdHash: string;
  roomMessageKey: CryptoKey;
  clientId: string;
  securityCode: string;
}

interface JoinInput {
  roomNumber: string;
  passphrase: string;
}

const statusRank: Record<LocalMessageStatus, number> = {
  sending: 1,
  server_ack: 2,
  stored: 3,
  peer_offline: 3,
  delivered: 4,
  decrypted: 5,
  visible: 6,
  seen: 7,
  burning: 8,
  burned: 9,
  failed: 99,
  undecryptable: 99
};

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

const statusFromServerState = (state: HistoryMessage["state"]): LocalMessageStatus =>
  state === "seen" ? "seen" : state;

export const useSecretRoom = () => {
  const [roomState, setRoomState] = useState<RoomState>("idle");
  const [roomNumber, setRoomNumber] = useState("");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [selectedBurnTime, setSelectedBurnTime] = useState<BurnAfterMs>(30000);
  const [securityCode, setSecurityCode] = useState("");
  const [statusText, setStatusText] = useState("");
  const [isBlurred, setIsBlurred] = useState(false);
  const [isWindowHidden, setIsWindowHidden] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const activeRef = useRef<ActiveMaterial | null>(null);
  const burnTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const manualCloseRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const joinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joinAttemptRef = useRef(0);
  const roomStateRef = useRef<RoomState>("idle");
  const isBlurredRef = useRef(false);
  const isWindowHiddenRef = useRef(false);
  const serverTimeOffsetRef = useRef(0);
  const visibleSentRef = useRef(new Set<string>());
  const seenSentRef = useRef(new Set<string>());
  const deliveredSentRef = useRef(new Set<string>());
  const decryptedSentRef = useRef(new Set<string>());

  const estimateServerNow = useCallback(() => Date.now() + serverTimeOffsetRef.current, []);

  const syncServerTime = useCallback((serverTime: number) => {
    if (!Number.isFinite(serverTime)) return;
    serverTimeOffsetRef.current = serverTime - Date.now();
    setNow(serverTime);
  }, []);

  const setRoomStateValue = useCallback((nextState: RoomState) => {
    roomStateRef.current = nextState;
    setRoomState(nextState);
  }, []);

  useEffect(() => {
    roomStateRef.current = roomState;
  }, [roomState]);

  useEffect(() => {
    isBlurredRef.current = isBlurred;
  }, [isBlurred]);

  useEffect(() => {
    isWindowHiddenRef.current = isWindowHidden;
  }, [isWindowHidden]);

  const clearBurnTimers = useCallback(() => {
    for (const timer of burnTimersRef.current.values()) {
      clearTimeout(timer);
    }
    burnTimersRef.current.clear();
  }, []);

  const clearJoinTimeout = useCallback(() => {
    if (joinTimeoutRef.current) {
      clearTimeout(joinTimeoutRef.current);
      joinTimeoutRef.current = null;
    }
  }, []);

  const wipeLocalSession = useCallback(() => {
    clearJoinTimeout();
    clearBurnTimers();
    activeRef.current = null;
    visibleSentRef.current.clear();
    seenSentRef.current.clear();
    deliveredSentRef.current.clear();
    decryptedSentRef.current.clear();
    setMessages([]);
    setSecurityCode("");
  }, [clearBurnTimers, clearJoinTimeout]);

  const sendEvent = useCallback((event: ClientEvent) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(event));
    return true;
  }, []);

  const sendLeave = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;
    sendEvent({
      type: "room:leave",
      roomIdHash: active.roomIdHash,
      clientId: active.clientId
    });
  }, [sendEvent]);

  const closeSocket = useCallback(
    (notifyLeave = true) => {
      manualCloseRef.current = true;
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (notifyLeave) sendLeave();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close(1000, "local close");
      }
      wsRef.current = null;
    },
    [sendLeave]
  );

  const scheduleBurn = useCallback(
    (messageId: string, burnAt: number) => {
      const existing = burnTimersRef.current.get(messageId);
      if (existing) clearTimeout(existing);

      const delay = Math.max(0, burnAt - estimateServerNow());
      const timer = setTimeout(() => {
        burnTimersRef.current.delete(messageId);
        setMessages((current) => current.filter((message) => message.id !== messageId));
      }, delay);

      burnTimersRef.current.set(messageId, timer);
    },
    [estimateServerNow]
  );

  const updateMessageStatus = useCallback(
    (messageId: string, nextStatus: LocalMessageStatus, extra: Partial<LocalMessage> = {}) => {
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== messageId) return message;
          if (statusRank[message.status] > statusRank[nextStatus] && message.status !== "peer_offline") {
            return { ...message, ...extra };
          }
          return {
            ...message,
            ...extra,
            status: nextStatus
          };
        })
      );
    },
    []
  );

  const removeBurnedMessage = useCallback((messageId: string) => {
    const timer = burnTimersRef.current.get(messageId);
    if (timer) clearTimeout(timer);
    burnTimersRef.current.delete(messageId);
    setMessages((current) => current.filter((message) => message.id !== messageId));
  }, []);

  const sendProgress = useCallback(
    (type: "message:delivered" | "message:decrypted" | "message:visible", messageId: string) => {
      const active = activeRef.current;
      if (!active) return false;
      return sendEvent({
        type,
        roomIdHash: active.roomIdHash,
        clientId: active.clientId,
        messageId,
        at: Date.now()
      });
    },
    [sendEvent]
  );

  const sendDelivered = useCallback(
    (messageId: string) => {
      if (deliveredSentRef.current.has(messageId)) return;
      if (sendProgress("message:delivered", messageId)) {
        deliveredSentRef.current.add(messageId);
      }
    },
    [sendProgress]
  );

  const sendDecrypted = useCallback(
    (messageId: string) => {
      if (decryptedSentRef.current.has(messageId)) return;
      if (sendProgress("message:decrypted", messageId)) {
        decryptedSentRef.current.add(messageId);
      }
    },
    [sendProgress]
  );

  const canConfirmSeen = useCallback(() => {
    const socket = wsRef.current;
    return (
      roomStateRef.current === "active" &&
      !isWindowHiddenRef.current &&
      document.visibilityState === "visible" &&
      socket?.readyState === WebSocket.OPEN
    );
  }, []);

  const handleEncryptedMessage = useCallback(
    async (encrypted: CipherMessage | HistoryMessage, sourceState: HistoryMessage["state"] = "stored") => {
      const active = activeRef.current;
      if (!active) return;
      if (encrypted.roomIdHash !== active.roomIdHash) return;

      const from: LocalMessage["from"] = encrypted.senderClientId === active.clientId ? "me" : "peer";
      const existingStatus = statusFromServerState(sourceState);
      const burnAt = "burnAt" in encrypted ? encrypted.burnAt : undefined;
      const seenAt = "seenAt" in encrypted ? encrypted.seenAt : undefined;

      if (from === "peer") {
        sendDelivered(encrypted.messageId);
      }

      try {
        const text = await decryptText(active.roomMessageKey, active.roomIdHash, encrypted);
        if (from === "peer") {
          sendDecrypted(encrypted.messageId);
        }

        setMessages((current) => {
          const already = current.some((message) => message.id === encrypted.messageId);
          if (already) {
            return current.map((message) =>
              message.id === encrypted.messageId
                ? {
                    ...message,
                    decryptedText: text,
                    ...(from === "me" ? { displayText: text } : {}),
                    ciphertext: encrypted.ciphertext,
                    iv: encrypted.iv,
                    aad: encrypted.aad,
                    status:
                      existingStatus === "burning" || existingStatus === "seen"
                        ? "burning"
                        : statusRank[message.status] >= statusRank[existingStatus]
                          ? message.status
                          : existingStatus,
                    ...(typeof seenAt === "number" ? { seenAt } : {}),
                    ...(typeof burnAt === "number" ? { burnAt } : {})
                  }
                : message
            );
          }

          return [
            ...current,
            {
              id: encrypted.messageId,
              from,
              decryptedText: text,
              ...(from === "me" ? { displayText: text } : {}),
              ciphertext: encrypted.ciphertext,
              iv: encrypted.iv,
              aad: encrypted.aad,
              burnAfterMs: encrypted.burnAfterMs,
              createdAt: encrypted.createdAt,
              status:
                existingStatus === "burning" || existingStatus === "seen"
                  ? "burning"
                  : from === "peer"
                    ? "decrypted"
                    : existingStatus,
              ...(typeof seenAt === "number" ? { seenAt } : {}),
              ...(typeof burnAt === "number" ? { burnAt } : {})
            }
          ];
        });

        if ((existingStatus === "burning" || existingStatus === "seen") && typeof burnAt === "number") {
          scheduleBurn(encrypted.messageId, burnAt);
        }
      } catch {
        setMessages((current) => {
          if (current.some((message) => message.id === encrypted.messageId)) return current;
          return [
            ...current,
            {
              id: encrypted.messageId,
              from,
              displayText: "无法解密",
              ciphertext: encrypted.ciphertext,
              iv: encrypted.iv,
              aad: encrypted.aad,
              burnAfterMs: encrypted.burnAfterMs,
              createdAt: encrypted.createdAt,
              status: "undecryptable"
            }
          ];
        });
      }
    },
    [scheduleBurn, sendDecrypted, sendDelivered]
  );

  const markBurning = useCallback(
    (messageId: string, seenBy: string, seenAt: number, burnAt: number) => {
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== messageId) return message;
          const wasRevealedByThisClient = seenBy === activeRef.current?.clientId;
          scheduleBurn(message.id, burnAt);
          return {
            ...message,
            status: "burning",
            seenAt,
            burnAt,
            ...(wasRevealedByThisClient && message.decryptedText
              ? { displayText: message.decryptedText, revealedAt: seenAt }
              : {})
          };
        })
      );
    },
    [scheduleBurn]
  );

  const handleServerEvent = useCallback(
    async (event: ServerEvent) => {
      if ("serverTime" in event) {
        syncServerTime(event.serverTime);
      }

      switch (event.type) {
        case "room:waiting":
          clearJoinTimeout();
          setStatusText("等待另一端唤醒房间");
          setRoomStateValue("waiting");
          break;
        case "room:active":
          clearJoinTimeout();
          setStatusText("双方在线");
          setRoomStateValue("active");
          setMessages((current) =>
            current.map((message) =>
              message.status === "peer_offline" ? { ...message, status: "stored" } : message
            )
          );
          break;
        case "room:peer_offline":
          clearJoinTimeout();
          setStatusText("对方已离线，房间仍保留");
          setRoomStateValue("peer_offline");
          setMessages((current) =>
            current.map((message) =>
              message.from === "me" && !["burning", "burned", "failed"].includes(message.status)
                ? { ...message, status: "peer_offline" }
                : message
            )
          );
          break;
        case "room:suspended":
          clearJoinTimeout();
          setStatusText("房间暂时无人在线，可重新唤醒");
          setRoomStateValue("suspended");
          break;
        case "room:resumed":
          setStatusText("房间已恢复，正在同步未焚毁密文");
          break;
        case "room:sync":
          break;
        case "room:unavailable":
          clearJoinTimeout();
          wipeLocalSession();
          closeSocket(false);
          setStatusText("房间暂不可用");
          setRoomStateValue("unavailable");
          break;
        case "message:server_ack":
          updateMessageStatus(event.messageId, event.state === "server_ack" ? "server_ack" : "stored");
          if (roomStateRef.current === "peer_offline") {
            updateMessageStatus(event.messageId, "peer_offline");
          }
          break;
        case "message:receive":
          await handleEncryptedMessage(event.message, event.state);
          break;
        case "message:history":
          await Promise.all(event.messages.map((message) => handleEncryptedMessage(message, message.state)));
          break;
        case "message:delivered":
          updateMessageStatus(event.messageId, "delivered");
          break;
        case "message:decrypted":
          updateMessageStatus(event.messageId, "decrypted");
          break;
        case "message:visible":
          updateMessageStatus(event.messageId, "visible");
          break;
        case "message:seen":
          markBurning(event.messageId, event.seenBy, event.seenAt, event.burnAt);
          break;
        case "message:burn":
          removeBurnedMessage(event.messageId);
          break;
        case "message:failed":
          if (event.messageId) updateMessageStatus(event.messageId, "failed");
          setStatusText(event.reason === "rate_limited" ? "连接过于频繁，请稍后再试" : "发送失败");
          break;
        case "peer:left":
          setStatusText("对方已离线，房间仍保留");
          setRoomStateValue("peer_offline");
          break;
        case "peer:reconnected":
          setStatusText("双方在线");
          setRoomStateValue("active");
          break;
        case "room:destroyed":
          clearJoinTimeout();
          wipeLocalSession();
          closeSocket(false);
          setStatusText("房间已销毁");
          setRoomStateValue("destroyed");
          break;
        case "room:expired":
          clearJoinTimeout();
          wipeLocalSession();
          closeSocket(false);
          setStatusText("房间已过期");
          setRoomStateValue("expired");
          break;
        case "error":
          clearJoinTimeout();
          setStatusText(event.message);
          if (roomStateRef.current === "joining" || event.message.includes("频繁")) {
            setRoomStateValue("unavailable");
          }
          break;
        case "pong":
          break;
      }
    },
    [
      closeSocket,
      clearJoinTimeout,
      handleEncryptedMessage,
      markBurning,
      removeBurnedMessage,
      setRoomStateValue,
      syncServerTime,
      updateMessageStatus,
      wipeLocalSession
    ]
  );

  const joinRoom = useCallback(
    async ({ roomNumber: nextRoomNumber, passphrase }: JoinInput) => {
      const cleanRoom = nextRoomNumber.trim();
      const cleanPassphrase = passphrase.trim();
      if (!cleanRoom || !cleanPassphrase || roomStateRef.current === "joining") return;

      closeSocket(true);
      wipeLocalSession();
      const joinAttempt = joinAttemptRef.current + 1;
      joinAttemptRef.current = joinAttempt;
      manualCloseRef.current = false;
      setRoomNumber(cleanRoom);
      setStatusText("正在唤醒房间");
      setRoomStateValue("joining");
      roomStateRef.current = "joining";
      setIsWindowHidden(false);
      clearJoinTimeout();
      joinTimeoutRef.current = setTimeout(() => {
        if (joinAttemptRef.current !== joinAttempt) return;
        if (roomStateRef.current !== "joining") return;
        joinAttemptRef.current += 1;
        closeSocket(false);
        wipeLocalSession();
        setStatusText("连接超时，请刷新后重试");
        setRoomStateValue("unavailable");
      }, 15_000);

      try {
        const roomMaterial = await deriveRoomMaterial(cleanRoom, cleanPassphrase);
        if (joinAttemptRef.current !== joinAttempt || roomStateRef.current !== "joining") return;
        const clientId = randomToken("client");
        activeRef.current = {
          ...roomMaterial,
          clientId
        };
        setSecurityCode(roomMaterial.securityCode);

        const socket = new WebSocket(resolveWsUrl());
        wsRef.current = socket;

        socket.addEventListener("open", () => {
          if (joinAttemptRef.current !== joinAttempt) return;
          const active = activeRef.current;
          if (!active) return;
          sendEvent({
            type: "room:join",
            roomIdHash: active.roomIdHash,
            clientId: active.clientId
          });
          heartbeatRef.current = setInterval(() => {
            sendEvent({ type: "ping", clientId: active.clientId, sentAt: Date.now() });
          }, 15_000);
        });

        socket.addEventListener("message", (message) => {
          if (joinAttemptRef.current !== joinAttempt) return;
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
          if (joinAttemptRef.current !== joinAttempt) return;
          if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
          }
          if (!manualCloseRef.current && !["idle", "destroyed", "expired", "unavailable"].includes(roomStateRef.current)) {
            setStatusText("连接已断开，重新输入房间号和口令可恢复未焚毁消息");
            setRoomStateValue("suspended");
          }
        });

        socket.addEventListener("error", () => {
          if (joinAttemptRef.current !== joinAttempt) return;
          clearJoinTimeout();
          setStatusText("连接异常，重新输入房间号和口令可恢复未焚毁消息");
          if (roomStateRef.current === "joining") {
            setRoomStateValue("unavailable");
          }
        });
      } catch {
        joinAttemptRef.current += 1;
        wipeLocalSession();
        setStatusText("房间暂不可用");
        setRoomStateValue("unavailable");
      }
    },
    [clearJoinTimeout, closeSocket, handleServerEvent, sendEvent, setRoomStateValue, wipeLocalSession]
  );

  const sendTextMessage = useCallback(
    async (text: string) => {
      const cleanText = text.trim();
      const active = activeRef.current;
      if (!cleanText || !active || !["active", "peer_offline"].includes(roomStateRef.current)) return false;

      try {
        const encrypted = await encryptText(
          active.roomMessageKey,
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
            decryptedText: cleanText,
            displayText: cleanText,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            aad: encrypted.aad,
            burnAfterMs: encrypted.burnAfterMs,
            createdAt: encrypted.createdAt,
            status: "sending"
          }
        ]);
        const sent = sendEvent({
          type: "message:send",
          roomIdHash: active.roomIdHash,
          clientId: active.clientId,
          message: encrypted
        });
        if (!sent) {
          updateMessageStatus(encrypted.messageId, "failed");
          return false;
        }
        return true;
      } catch {
        setStatusText("消息发送失败");
        return false;
      }
    },
    [selectedBurnTime, sendEvent, updateMessageStatus]
  );

  const destroyRoom = useCallback(() => {
    const active = activeRef.current;
    if (active) {
      sendEvent({
        type: "room:destroy",
        roomIdHash: active.roomIdHash,
        clientId: active.clientId
      });
    }
    wipeLocalSession();
    closeSocket(false);
    setStatusText("房间已销毁");
    setRoomStateValue("destroyed");
  }, [closeSocket, sendEvent, setRoomStateValue, wipeLocalSession]);

  const reset = useCallback(() => {
    joinAttemptRef.current += 1;
    closeSocket(true);
    wipeLocalSession();
    setRoomNumber("");
    setStatusText("");
    setIsBlurred(false);
    setIsWindowHidden(false);
    setRoomStateValue("idle");
  }, [closeSocket, setRoomStateValue, wipeLocalSession]);

  const hideWindow = useCallback(() => {
    setIsWindowHidden(true);
  }, []);

  const revealWindow = useCallback(() => {
    setIsWindowHidden(false);
  }, []);

  const confirmPeerMessageSeen = useCallback(
    (messageId: string) => {
      if (!canConfirmSeen() || seenSentRef.current.has(messageId)) return false;

      const message = messages.find((item) => item.id === messageId);
      if (
        !message ||
        message.from !== "peer" ||
        !message.decryptedText ||
        message.displayText ||
        message.status === "undecryptable" ||
        message.status === "burning" ||
        message.status === "burned"
      ) {
        return false;
      }

      let visibleReady = visibleSentRef.current.has(message.id);
      if (!visibleReady) {
        visibleReady = sendProgress("message:visible", message.id);
        if (visibleReady) visibleSentRef.current.add(message.id);
      }
      if (!visibleReady) return false;

      const active = activeRef.current;
      if (!active) return false;

      const sent = sendEvent({
        type: "message:seen",
        roomIdHash: active.roomIdHash,
        clientId: active.clientId,
        messageId: message.id,
        confirm: "user-click"
      });
      if (sent) {
        seenSentRef.current.add(message.id);
        updateMessageStatus(message.id, "visible", {
          displayText: message.decryptedText,
          revealedAt: estimateServerNow()
        });
      }
      return sent;
    },
    [canConfirmSeen, estimateServerNow, messages, sendEvent, sendProgress, updateMessageStatus]
  );

  useEffect(() => {
    const tick = setInterval(() => setNow(estimateServerNow()), 250);
    return () => clearInterval(tick);
  }, [estimateServerNow]);

  useEffect(() => {
    const visibility = () => {
      setIsBlurred(document.visibilityState !== "visible");
    };

    visibility();
    document.addEventListener("visibilitychange", visibility);

    return () => {
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(
    () => () => {
      closeSocket(true);
      wipeLocalSession();
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
      isWindowHidden,
      now,
      joinRoom,
      sendTextMessage,
      setSelectedBurnTime,
      confirmPeerMessageSeen,
      destroyRoom,
      reset,
      hideWindow,
      revealWindow
    }),
    [
      destroyRoom,
      hideWindow,
      isBlurred,
      isWindowHidden,
      joinRoom,
      messages,
      now,
      confirmPeerMessageSeen,
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

