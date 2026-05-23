"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  ImagePlus,
  KeyRound,
  Lock,
  Radio,
  Send,
  Shield,
  Trash2,
  X
} from "lucide-react";
import { useSecretRoom } from "@/hooks/useSecretRoom";
import { OfflineSecretApp } from "@/components/OfflineSecretApp";
import { burnOptions, type BurnAfterMs, type ClientPlatform, type LocalMessage, type RoomState } from "@/types/protocol";

type RoomController = ReturnType<typeof useSecretRoom>;

export function SecretRoomApp() {
  const room = useSecretRoom();
  const [surface, setSurface] = useState<"room" | "letter">(() => {
    if (typeof window === "undefined") return "room";
    return window.location.pathname.startsWith("/letter/") || window.location.search.includes("letter=") ? "letter" : "room";
  });

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-ink text-bright">
      <BackgroundEffect />
      {surface === "letter" ? (
        <OfflineSecretApp onBack={() => setSurface("room")} />
      ) : (
        <>
          {room.roomState === "idle" || room.roomState === "joining" ? (
            <JoinRoomForm room={room} onOpenLetter={() => setSurface("letter")} />
          ) : null}
          {room.roomState === "waiting" ? <WaitingRoom room={room} /> : null}
          {["active", "peer_offline", "suspended"].includes(room.roomState) ? <ChatRoom room={room} /> : null}
          {room.roomState === "unavailable" ? <UnavailableRoom room={room} /> : null}
          {room.roomState === "destroyed" ? <DestroyedRoom room={room} /> : null}
          {room.roomState === "expired" ? <ExpiredRoom room={room} /> : null}
        </>
      )}
    </main>
  );
}

function BackgroundEffect() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden bg-ink">
      <div className="secure-field absolute inset-0 opacity-[0.18]" />
      <div className="signal-sweep absolute inset-y-0 w-1/2 opacity-60" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,5,5,0.15),#050505_82%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-brand/30" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-brand/10" />
    </div>
  );
}

function JoinRoomForm({ room, onOpenLetter }: { room: RoomController; onOpenLetter: () => void }) {
  const [roomNumber, setRoomNumber] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const isJoining = room.roomState === "joining";
  const canSubmit = roomNumber.trim().length > 0 && passphrase.trim().length > 0 && !isJoining;

  return (
    <section className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-5 flex justify-center">
            <div className="flex size-14 items-center justify-center border border-brand/40 bg-brand/10">
              <Shield className="size-7 text-brand" strokeWidth={1.5} />
            </div>
          </div>
          <h1 className="mb-3 text-2xl font-bold uppercase text-bright">临时密聊房间</h1>
          <p className="mb-2 text-sm font-semibold uppercase tracking-[2px] text-brand">Secret Room</p>
          <p className="mx-auto max-w-[19rem] px-2 text-sm leading-relaxed text-dim sm:max-w-none">
            输入相同的房间号和口令，唤醒一个只容纳两人的临时房间。
          </p>
          <p className="mx-auto mt-2 max-w-[20rem] px-4 text-xs leading-relaxed text-mute sm:max-w-none">
            无账号、无昵称、无头像。服务端只短期保存密文，用于断线后恢复。
          </p>
        </div>

        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) {
              void room.joinRoom({ roomNumber, passphrase });
            }
          }}
        >
          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[2px] text-dim">房间号</span>
            <input
              value={roomNumber}
              onChange={(event) => setRoomNumber(event.target.value)}
              className="w-full border border-line bg-panel px-4 py-3 text-sm text-bright outline-none transition-colors placeholder:text-mute focus:border-brand/70"
              placeholder="输入房间号"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[2px] text-dim">房间口令</span>
            <span className="relative block">
              <input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                className="w-full border border-line bg-panel px-4 py-3 pr-11 text-sm text-bright outline-none transition-colors placeholder:text-mute focus:border-brand/70"
                placeholder="输入房间口令"
                autoComplete="off"
                spellCheck={false}
              />
              <Lock className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-mute" />
            </span>
          </label>

          <button
            type="submit"
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 bg-brand px-4 py-3.5 text-sm font-bold uppercase tracking-[2px] text-ink transition-colors hover:bg-[#00a88f] disabled:cursor-not-allowed disabled:opacity-30"
          >
            {isJoining ? (
              <>
                <span className="size-4 animate-spin border-2 border-ink/30 border-t-ink" />
                正在唤醒
              </>
            ) : (
              <>
                唤醒房间
                <ChevronRight className="size-4" />
              </>
            )}
          </button>
        </form>

        <button
          type="button"
          onClick={onOpenLetter}
          className="mt-4 flex w-full items-center justify-center gap-2 border border-brand/30 px-4 py-3 text-sm font-bold uppercase tracking-[2px] text-brand transition-colors hover:bg-brand/10"
        >
          <KeyRound className="size-4" />
          密信传递
        </button>

        {room.statusText ? <p className="mt-4 text-center text-xs text-dim">{room.statusText}</p> : null}

        <div className="mt-8 flex flex-col gap-3 border-t border-line pt-6">
          <SecurityNote icon={<Lock className="size-3.5" />} text="服务端不接触明文、口令或房间消息密钥。" />
          <SecurityNote icon={<EyeOff className="size-3.5" />} text="IP 仅用于风控，不展示给任何用户。" />
          <SecurityNote icon={<Shield className="size-3.5" />} text="刷新后需重新输入房间号和口令来恢复未焚毁密文。" />
        </div>

        <div className="mt-8 border border-danger/20 bg-danger/5 px-4 py-3 text-center">
          <p className="text-xs leading-relaxed text-danger/80">无法阻止屏幕截图或拍照，请在可信环境中使用。</p>
        </div>
      </div>
    </section>
  );
}

function SecurityNote({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2.5 text-mute">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="text-xs leading-relaxed">{text}</p>
    </div>
  );
}

function WaitingRoom({ room }: { room: RoomController }) {
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const timer = setInterval(() => {
      setDots((current) => (current.length >= 3 ? "." : `${current}.`));
    }, 600);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex justify-center">
          <div className="relative">
            <div className="flex size-16 items-center justify-center border border-brand/30 bg-brand/5">
              <Radio className="size-7 animate-pulse text-brand" strokeWidth={1.5} />
            </div>
            <div className="absolute inset-0 animate-ping border border-brand/10 [animation-duration:2s]" />
            <div className="absolute -inset-3 animate-ping border border-brand/5 [animation-delay:0.5s] [animation-duration:3s]" />
          </div>
        </div>

        <h2 className="mb-3 text-lg font-bold uppercase tracking-[2px] text-bright">等待另一端唤醒房间</h2>
        <p className="mb-2 text-sm text-dim">请让对方输入相同的房间号和口令。</p>
        <p className="mb-8 text-xs text-mute">等待中{dots}</p>

        <div className="mb-8 border border-line bg-panel/80 p-4 text-left">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs uppercase tracking-[2px] text-mute">房间号</span>
            <span className="truncate text-sm text-bright">{room.roomNumber}</span>
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-xs leading-relaxed text-dim">
              安全码已由房间号和口令派生。双方看到的安全码不一致时，请停止使用。
            </p>
          </div>
        </div>

        <SecurityCode value={room.securityCode} />

        <button
          onClick={room.reset}
          className="mt-8 inline-flex items-center gap-2 border border-line px-5 py-2.5 text-xs uppercase tracking-[2px] text-dim transition-colors hover:border-danger/50 hover:text-danger"
        >
          <ArrowLeft className="size-3.5" />
          离开房间
        </button>
      </div>
    </section>
  );
}

function ChatRoom({ room }: { room: RoomController }) {
  const [inputText, setInputText] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showDestroyDialog, setShowDestroyDialog] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const canSend = ["active", "peer_offline"].includes(room.roomState);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [room.messages]);

  return (
    <section className="relative z-10 flex h-[100dvh] flex-col overflow-hidden">
      {room.isWindowHidden ? <HiddenOverlay onReveal={room.revealWindow} /> : null}

      <header className="shrink-0 border-b border-line bg-panel/90 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-3 py-2.5 md:px-4">
          <div className="mb-2 flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`size-1.5 shrink-0 ${room.roomState === "active" ? "animate-pulse bg-brand" : "bg-danger"}`} />
              <span className="truncate text-xs font-semibold uppercase tracking-[2px] text-brand">
                {room.roomState === "active" ? roomStatusLabel(room.roomState) : room.statusText || roomStatusLabel(room.roomState)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={room.hideWindow}
                className="inline-flex items-center gap-1.5 border border-line px-2.5 py-1.5 text-xs uppercase tracking-[1px] text-dim transition-colors hover:border-brand/40 hover:text-brand"
                title="隐藏窗口"
              >
                <EyeOff className="size-3" />
                <span className="hidden sm:inline">隐藏</span>
              </button>
              <button
                onClick={() => setShowDestroyDialog(true)}
                className="inline-flex items-center gap-1.5 border border-danger/40 px-2.5 py-1.5 text-xs uppercase tracking-[1px] text-danger transition-colors hover:bg-danger/10"
                title="销毁房间"
              >
                <Trash2 className="size-3" />
                <span className="hidden sm:inline">销毁</span>
              </button>
            </div>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-relaxed text-mute">
            <span>{peerPresenceLabel(room)}</span>
            <span className="hidden h-3 w-px bg-line sm:inline-block" aria-hidden="true" />
            <span>本机：{platformLabel(room.clientPlatform)}</span>
          </div>
          <SecurityCode value={room.securityCode} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div
          className={`mx-auto flex min-h-full max-w-3xl flex-col gap-4 px-3 py-5 transition duration-200 md:px-4 md:py-6 ${
            room.isBlurred || room.isWindowHidden ? "blur-sm select-none" : ""
          }`}
        >
          {room.messages.length === 0 ? (
            <EmptyConversation roomState={room.roomState} />
          ) : (
            room.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                now={room.now}
                onConfirmSeen={room.confirmPeerMessageSeen}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <footer className="shrink-0 border-t border-line bg-panel/90 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-3 py-3 md:px-4">
          <BurnTimeSelector value={room.selectedBurnTime} onChange={room.setSelectedBurnTime} />
          <form
            className="mt-3 flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void room.sendTextMessage(inputText).then((sent) => {
                if (sent) setInputText("");
              });
            }}
          >
            <input
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              disabled={!canSend}
              className="min-w-0 flex-1 border-b border-brand/30 bg-transparent px-0 py-2.5 text-sm text-bright outline-none transition-colors placeholder:text-mute focus:border-brand disabled:cursor-not-allowed disabled:opacity-40"
              placeholder={canSend ? "输入加密消息..." : "重新进入房间后继续发送"}
              autoComplete="off"
              spellCheck={false}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="sr-only"
              data-testid="attachment-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) void room.sendAttachmentMessage(file);
              }}
            />
            <button
              type="button"
              disabled={!canSend}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 border border-line px-3 text-xs font-semibold text-dim transition-colors hover:border-brand/50 hover:text-brand disabled:cursor-not-allowed disabled:opacity-30"
              title="发送图片或视频"
              aria-label="发送图片或视频"
            >
              <ImagePlus className="size-4" />
              <span>图片/视频</span>
            </button>
            <button
              type="submit"
              disabled={!inputText.trim() || !canSend}
              className="inline-flex shrink-0 items-center gap-1.5 bg-brand px-4 py-2.5 text-xs font-bold uppercase tracking-[2px] text-ink transition-colors hover:bg-[#00a88f] disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Send className="size-3.5" />
              <span className="hidden sm:inline">发送</span>
            </button>
          </form>
          <p className="mt-2 text-xs text-mute">
            对方点击收到的消息后才开始倒计时，当前 {room.selectedBurnTime / 1000} 秒。图片/视频单个最多 4 MB。
          </p>
          <p className="mt-1 text-xs text-danger/70">
            网页端无法阻止屏幕截图或拍照；Android App 会启用系统级防截图保护。
          </p>
        </div>
      </footer>

      {showDestroyDialog ? (
        <DestroyRoomDialog
          onClose={() => setShowDestroyDialog(false)}
          onDestroy={() => {
            setShowDestroyDialog(false);
            room.destroyRoom();
          }}
        />
      ) : null}
    </section>
  );
}

function roomStatusLabel(state: RoomState) {
  if (state === "active") return "房间已封锁，双方在线";
  if (state === "peer_offline") return "对方已离线，房间仍保留";
  if (state === "suspended") return "房间暂时无人在线，可重新唤醒";
  return "等待另一端";
}

function platformLabel(platform: ClientPlatform) {
  if (platform === "android") return "Android App";
  if (platform === "ios") return "iOS App";
  return "网页端";
}

function peerPresenceLabel(room: RoomController) {
  const presence = room.peerPresence;
  if (room.roomState === "peer_offline" || presence.status === "offline") return "对方已离线";
  if (presence.status === "online" && presence.platform) return `对方在 ${platformLabel(presence.platform)} 打开`;
  if (room.roomState === "active") return "对方在线，端类型同步中";
  return "等待对方端类型";
}

function SecurityCode({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!value) return null;

  return (
    <div className="border border-brand/20 bg-brand/5">
      <button
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-[2px] text-brand">安全码</span>
          <span className="truncate text-xs text-brand/70">{value}</span>
        </span>
        <span className="text-xs text-brand/50">{expanded ? "收起" : "核对"}</span>
      </button>
      {expanded ? (
        <div className="border-t border-brand/10 px-3 py-3">
          <p className="mb-2 break-words text-lg font-semibold tracking-[2px] text-brand sm:text-xl">{value}</p>
          <p className="text-xs leading-relaxed text-dim">
            请通过其他可信渠道核对安全码。安全码不一致时，说明房间号或口令不同，或连接环境不可信。
          </p>
        </div>
      ) : null}
    </div>
  );
}

function EmptyConversation({ roomState }: { roomState: RoomState }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center border border-line">
        <Lock className="size-5 text-mute" />
      </div>
      <p className="mb-1 text-xs uppercase tracking-[2px] text-mute">密聊已就绪</p>
      <p className="text-xs text-mute/70">
        {roomState === "peer_offline" ? "对方离线时消息会先暂存为密文。" : "发送消息开始对话。"}
      </p>
    </div>
  );
}

function BurnTimeSelector({
  value,
  onChange
}: {
  value: BurnAfterMs;
  onChange: (value: BurnAfterMs) => void;
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
      <Clock className="size-3.5 shrink-0 text-mute" />
      <span className="hidden shrink-0 text-xs font-semibold uppercase tracking-[2px] text-mute sm:inline">阅后即焚</span>
      <div className="flex shrink-0 border border-line">
        {burnOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`border px-3 py-1.5 text-xs transition-colors ${
              value === option.value
                ? "border-brand/40 bg-brand/20 text-brand"
                : "border-transparent text-mute hover:text-dim"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  now,
  onConfirmSeen
}: {
  message: LocalMessage;
  now: number;
  onConfirmSeen: (messageId: string) => boolean;
}) {
  const isMe = message.from === "me";
  if (message.from === "system") {
    return (
      <div className="flex justify-center">
        <div className="max-w-[90%] border border-danger/20 bg-danger/5 px-3 py-2 text-center text-xs leading-relaxed text-danger/90">
          {message.systemText}
        </div>
      </div>
    );
  }

  const canConfirmSeen =
    !isMe &&
    Boolean(message.decryptedText || message.decryptedAttachment) &&
    !message.displayText &&
    !message.displayAttachment &&
    ["delivered", "decrypted", "visible"].includes(message.status);
  const visibleText =
    message.displayText ??
    (message.status === "undecryptable"
      ? "无法解密"
      : isMe
        ? message.decryptedAttachment
          ? "附件处理中"
          : "消息处理中"
        : message.decryptedAttachment
          ? "加密附件，点击查看"
          : "加密消息，点击查看");
  const timeLeft =
    message.status === "burning" && message.burnAt ? Math.max(0, message.burnAt - now) : undefined;
  const progress = timeLeft === undefined ? 0 : Math.max(0, Math.min(100, (timeLeft / message.burnAfterMs) * 100));

  return (
    <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
      <button
        type="button"
        onClick={() => {
          if (canConfirmSeen) onConfirmSeen(message.id);
        }}
        disabled={!canConfirmSeen}
        data-testid="message-bubble"
        className={`max-w-[85%] min-w-0 border-l-2 bg-message px-4 py-3 sm:max-w-[80%] ${
          isMe ? "border-brand" : "border-line"
        } ${canConfirmSeen ? "cursor-pointer text-left transition-colors hover:border-brand/70 hover:bg-panel focus:outline-none focus:ring-1 focus:ring-brand/60" : "cursor-default text-left"}`}
        aria-label={canConfirmSeen ? "确认查看消息并启动焚毁倒计时" : undefined}
      >
        <p className={`mb-1.5 text-xs font-semibold uppercase tracking-[2px] ${isMe ? "text-brand" : "text-dim"}`}>
          {isMe ? "你" : "对方"}
        </p>
        {message.displayAttachment ? <AttachmentPreview message={message} /> : null}
        {message.displayText || !message.displayAttachment ? (
          <p className="break-words text-sm leading-relaxed text-bright">{visibleText}</p>
        ) : null}
        <MessageStatusLine message={message} {...(timeLeft !== undefined ? { timeLeft } : {})} />
        {message.status === "burning" && timeLeft !== undefined ? (
          <div className="mt-3 flex items-center gap-2">
            <div className="h-0.5 flex-1 overflow-hidden bg-line">
              <div className="h-full bg-danger transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="min-w-10 text-right text-xs tabular-nums text-danger" data-testid="burn-countdown">
              {(timeLeft / 1000).toFixed(1)}s
            </span>
          </div>
        ) : null}
      </button>
    </div>
  );
}

function AttachmentPreview({ message }: { message: LocalMessage }) {
  const attachment = message.displayAttachment;
  if (!attachment) return null;

  return (
    <div className="mb-2 overflow-hidden border border-line/80 bg-ink/60" data-testid="attachment-preview">
      {attachment.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.objectUrl}
          alt={attachment.name}
          className="max-h-72 w-full max-w-sm object-contain"
          draggable={false}
        />
      ) : (
        <video
          src={attachment.objectUrl}
          controls
          preload="metadata"
          className="max-h-72 w-full max-w-sm bg-black"
          aria-label={attachment.name}
        />
      )}
      <div className="flex items-center justify-between gap-3 border-t border-line/80 px-3 py-2 text-xs text-mute">
        <span className="min-w-0 truncate">{attachment.name}</span>
        <span className="shrink-0">{formatBytes(attachment.size)}</span>
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function MessageStatusLine({ message, timeLeft }: { message: LocalMessage; timeLeft?: number }) {
  const text = messageStatusText(message, timeLeft);
  const tone =
    message.status === "failed" || message.status === "undecryptable"
      ? "text-danger"
      : message.status === "burning"
        ? "text-danger/90"
        : "text-mute";

  return <p className={`mt-2 text-xs uppercase tracking-[1px] ${tone}`}>{text}</p>;
}

function messageStatusText(message: LocalMessage, timeLeft?: number) {
  if (message.status === "sending") return "发送中";
  if (message.status === "server_ack") return "已发送";
  if (message.status === "stored") return message.from === "me" ? "已暂存，等待对方查看" : "已暂存";
  if (message.status === "delivered") return message.from === "me" ? "已送达" : "已收到";
  if (message.status === "decrypted" || message.status === "visible") {
    return message.from === "me" ? "等待对方点击查看" : "点击确认查看并启动倒计时";
  }
  if (message.status === "seen") return "对方已查看";
  if (message.status === "burning" && timeLeft !== undefined) {
    return `对方已查看，${Math.ceil(timeLeft / 1000)} 秒后焚毁`;
  }
  if (message.status === "peer_offline") return "对方离线，等待其重新进入";
  if (message.status === "undecryptable") return "无法解密";
  if (message.status === "failed") return "发送失败";
  return "已发送";
}

function HiddenOverlay({ onReveal }: { onReveal: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/95 px-4 backdrop-blur-xl">
      <div className="absolute inset-0 secure-field opacity-[0.06]" />
      <div className="relative z-10 max-w-sm text-center">
        <div className="mb-5 flex justify-center">
          <div className="flex size-14 items-center justify-center border border-brand/30 bg-brand/5">
            <Lock className="size-6 text-brand" strokeWidth={1.5} />
          </div>
        </div>
        <h3 className="mb-2 text-lg font-bold uppercase tracking-[2px] text-bright">窗口已隐藏</h3>
        <p className="mb-8 text-xs text-dim">聊天内容已被遮罩。隐藏期间不会发送查看确认，也不会启动焚毁倒计时。</p>
        <button
          onClick={onReveal}
          className="inline-flex items-center gap-2 bg-brand px-6 py-3 text-sm font-bold uppercase tracking-[2px] text-ink transition-colors hover:bg-[#00a88f]"
        >
          <Eye className="size-4" />
          恢复显示
        </button>
      </div>
    </div>
  );
}

function DestroyRoomDialog({ onClose, onDestroy }: { onClose: () => void; onDestroy: () => void }) {
  const [confirmText, setConfirmText] = useState("");
  const canDestroy = confirmText === "销毁";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <button className="absolute inset-0 bg-black/70" aria-label="关闭确认框" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm border border-danger/30 bg-panel">
        <div className="flex items-center justify-between border-b border-danger/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <Trash2 className="size-4 text-danger" />
            <span className="text-sm font-bold uppercase tracking-[2px] text-danger">销毁房间</span>
          </div>
          <button onClick={onClose} className="text-mute transition-colors hover:text-bright" aria-label="关闭">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm leading-relaxed text-bright">
            确认销毁房间？销毁后，本房间内所有暂存密文和状态都会被清除，无法恢复。
          </p>
          <p className="text-xs leading-relaxed text-dim">请输入“销毁”确认。</p>
          <input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            className="w-full border border-danger/30 bg-message px-4 py-2.5 text-sm text-bright outline-none transition-colors placeholder:text-mute focus:border-danger/70"
            placeholder="输入“销毁”"
            autoFocus
          />
        </div>
        <div className="flex border-t border-line">
          <button
            onClick={onClose}
            className="flex-1 border-r border-line py-3 text-xs uppercase tracking-[2px] text-dim transition-colors hover:bg-message"
          >
            取消
          </button>
          <button
            onClick={onDestroy}
            disabled={!canDestroy}
            className="flex flex-1 items-center justify-center gap-1.5 py-3 text-xs font-bold uppercase tracking-[2px] text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Trash2 className="size-3.5" />
            确认销毁
          </button>
        </div>
      </div>
    </div>
  );
}

function UnavailableRoom({ room }: { room: RoomController }) {
  return (
    <CenteredNotice
      icon={<AlertCircle className="size-6 text-dim" strokeWidth={1.5} />}
      title="房间暂不可用"
      body={room.statusText || "请稍后再试，或确认你输入的信息是否正确。"}
      actionLabel="返回首页"
      onAction={room.reset}
      tone="neutral"
    />
  );
}

function DestroyedRoom({ room }: { room: RoomController }) {
  return (
    <CenteredNotice
      icon={<Trash2 className="size-6 text-danger" strokeWidth={1.5} />}
      title="房间已销毁"
      body="本地消息、临时密钥和服务端暂存密文状态已经清除。"
      actionLabel="返回首页"
      onAction={room.reset}
      tone="danger"
    />
  );
}

function ExpiredRoom({ room }: { room: RoomController }) {
  return (
    <CenteredNotice
      icon={<Clock className="size-6 text-danger" strokeWidth={1.5} />}
      title="房间已过期"
      body="房间超过保留时间，服务端内存状态已经清除。"
      actionLabel="返回首页"
      onAction={room.reset}
      tone="danger"
    />
  );
}

function CenteredNotice({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  tone
}: {
  icon: ReactNode;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  tone: "neutral" | "danger";
}) {
  const color = tone === "danger" ? "border-danger/30 bg-danger/5" : "border-dim/30 bg-dim/5";

  return (
    <section className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className={`flex size-14 items-center justify-center border ${color}`}>{icon}</div>
        </div>
        <h2 className="mb-3 text-lg font-bold uppercase tracking-[2px] text-bright">{title}</h2>
        <p className="mb-8 text-sm leading-relaxed text-dim">{body}</p>
        <button
          onClick={onAction}
          className="inline-flex items-center gap-2 border border-line px-5 py-2.5 text-xs uppercase tracking-[2px] text-dim transition-colors hover:border-brand/50 hover:text-brand"
        >
          <ArrowLeft className="size-3.5" />
          {actionLabel}
        </button>
      </div>
    </section>
  );
}
