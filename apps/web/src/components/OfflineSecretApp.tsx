"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Clock, Copy, Eye, Flame, KeyRound, Lock, Send, Shield } from "lucide-react";
import {
  decryptOfflineSecretText,
  encryptOfflineSecretText,
  generateOfflinePasscode
} from "@/lib/crypto";
import {
  offlineReadTtlOptions,
  offlineUnreadTtlOptions,
  type OfflineReadTtlMs,
  type OfflineSecretCreateResponse,
  type OfflineSecretMetaResponse,
  type OfflineSecretOpenResponse,
  type OfflineUnreadTtlMs
} from "@/types/protocol";

interface OfflineSecretAppProps {
  onBack: () => void;
}

const apiBase = () => {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (configured) return configured.replace(/\/$/u, "");
  if (typeof window === "undefined") return "";
  return window.location.origin;
};

const safeSegment = (value: string | null) => (value && /^[A-Za-z0-9_-]+$/u.test(value) ? value : "");

const readRoute = () => {
  if (typeof window === "undefined") return { secretId: "", readToken: "" };
  const url = new URL(window.location.href);
  const routeMatch = url.pathname.match(/^\/letter\/([A-Za-z0-9_-]+)/u);
  return {
    secretId: safeSegment(routeMatch?.[1] ?? url.searchParams.get("letter")),
    readToken: safeSegment(url.searchParams.get("token"))
  };
};

const formatDateTime = (value: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);

const ttlLabel = (value: number) => {
  if (value < 60_000) return `${Math.round(value / 1000)} 秒`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)} 分钟`;
  if (value < 86_400_000) return `${Math.round(value / 3_600_000)} 小时`;
  return `${Math.round(value / 86_400_000)} 天`;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("request failed");
  return (await response.json()) as T;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`);
  if (!response.ok) throw new Error("request failed");
  return (await response.json()) as T;
}

export function OfflineSecretApp({ onBack }: OfflineSecretAppProps) {
  const route = useMemo(() => readRoute(), []);
  const isReader = Boolean(route.secretId && route.readToken);

  return (
    <section className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl">
        <button
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 border border-line px-3 py-2 text-xs uppercase tracking-[2px] text-dim transition-colors hover:border-brand/50 hover:text-brand"
        >
          <ArrowLeft className="size-3.5" />
          返回密聊
        </button>
        {isReader ? <ReadOfflineSecret secretId={route.secretId} readToken={route.readToken} /> : <CreateOfflineSecret />}
      </div>
    </section>
  );
}

function CreateOfflineSecret() {
  const [text, setText] = useState("");
  const [passcode, setPasscode] = useState(() => generateOfflinePasscode());
  const [unreadTtlMs, setUnreadTtlMs] = useState<OfflineUnreadTtlMs>(86_400_000);
  const [readTtlMs, setReadTtlMs] = useState<OfflineReadTtlMs>(30000);
  const [created, setCreated] = useState<OfflineSecretCreateResponse | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const letterUrl = useMemo(() => {
    if (!created || typeof window === "undefined") return "";
    return `${window.location.origin}/letter?letter=${created.secretId}&token=${created.readToken}`;
  }, [created]);

  const handleCreate = async () => {
    const cleanText = text.trim();
    const cleanPasscode = passcode.trim();
    if (!cleanText || !cleanPasscode || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const encrypted = await encryptOfflineSecretText(cleanText, cleanPasscode);
      const next = await postJson<OfflineSecretCreateResponse>("/api/offline-secrets", {
        ...encrypted,
        unreadTtlMs,
        readTtlMs
      });
      setCreated(next);
    } catch {
      setError("密信创建失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  const copyShare = async () => {
    if (!letterUrl) return;
    await navigator.clipboard.writeText(`密信链接：${letterUrl}\n阅读口令：${passcode}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  if (created) {
    return (
      <div className="border border-brand/20 bg-panel/90">
        <PanelHeader icon={<Check className="size-5 text-brand" />} title="密信已生成" />
        <div className="space-y-5 p-5">
          <InfoRow label="密信链接" value={letterUrl} />
          <InfoRow label="阅读口令" value={passcode} />
          <InfoRow label="未读过期" value={formatDateTime(created.unreadExpireAt)} />
          <InfoRow label="阅读后焚毁" value={ttlLabel(created.readTtlMs)} />
          <button
            onClick={copyShare}
            className="flex w-full items-center justify-center gap-2 bg-brand px-4 py-3 text-sm font-bold uppercase tracking-[2px] text-ink transition-colors hover:bg-[#00a88f]"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "已复制" : "复制链接和口令"}
          </button>
          <p className="text-xs leading-relaxed text-mute">
            请把链接和口令分开发送。服务器只保存密文和读取令牌哈希，不保存明文或口令。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-line bg-panel/90">
      <PanelHeader icon={<KeyRound className="size-5 text-brand" />} title="密信传递" />
      <div className="space-y-5 p-5">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[2px] text-dim">密信内容</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            maxLength={4000}
            className="w-full resize-none border border-line bg-message px-4 py-3 text-sm leading-relaxed text-bright outline-none transition-colors placeholder:text-mute focus:border-brand/70"
            placeholder="输入要留言的文字密信..."
          />
          <span className="mt-1 block text-right text-xs text-mute">{text.length}/4000</span>
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[2px] text-dim">阅读口令</span>
          <div className="flex gap-2">
            <input
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              className="min-w-0 flex-1 border border-line bg-message px-4 py-3 text-sm text-bright outline-none transition-colors placeholder:text-mute focus:border-brand/70"
            />
            <button
              onClick={() => setPasscode(generateOfflinePasscode())}
              type="button"
              className="shrink-0 border border-line px-3 text-xs uppercase tracking-[1px] text-dim transition-colors hover:border-brand/50 hover:text-brand"
            >
              生成
            </button>
          </div>
        </label>

        <OptionGroup title="未读保留" options={offlineUnreadTtlOptions} value={unreadTtlMs} onChange={setUnreadTtlMs} />
        <OptionGroup title="阅读后焚毁" options={offlineReadTtlOptions} value={readTtlMs} onChange={setReadTtlMs} />

        {error ? <p className="text-xs text-danger">{error}</p> : null}

        <button
          onClick={handleCreate}
          disabled={!text.trim() || !passcode.trim() || submitting}
          className="flex w-full items-center justify-center gap-2 bg-brand px-4 py-3 text-sm font-bold uppercase tracking-[2px] text-ink transition-colors hover:bg-[#00a88f] disabled:cursor-not-allowed disabled:opacity-30"
        >
          {submitting ? <span className="size-4 animate-spin border-2 border-ink/30 border-t-ink" /> : <Send className="size-4" />}
          生成密信
        </button>
      </div>
    </div>
  );
}

function ReadOfflineSecret({ secretId, readToken }: { secretId: string; readToken: string }) {
  const [passcode, setPasscode] = useState("");
  const [meta, setMeta] = useState<OfflineSecretMetaResponse | null>(null);
  const [opened, setOpened] = useState<OfflineSecretOpenResponse | null>(null);
  const [plaintext, setPlaintext] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const visibleSecret = opened;

  useEffect(() => {
    void getJson<OfflineSecretMetaResponse>(`/api/offline-secrets/${secretId}/meta`)
      .then(setMeta)
      .catch(() => setError("密信不存在或已经焚毁。"));
  }, [secretId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const burnAt = visibleSecret?.readExpireAt;
  const remaining = burnAt ? Math.max(0, burnAt - now) : undefined;

  const handleOpen = async () => {
    if (!passcode.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await postJson<OfflineSecretOpenResponse>(`/api/offline-secrets/${secretId}/open`, {
        readToken,
        readTtlMs: meta?.readTtlMs ?? 30000
      });
      const text = await decryptOfflineSecretText({
        ciphertext: response.ciphertext,
        iv: response.iv,
        aad: response.aad,
        salt: response.salt,
        passcode
      });
      setOpened(response);
      setPlaintext(text);
      setMeta(response);
    } catch {
      setError("无法打开密信。请确认链接和阅读口令是否正确，或密信是否已经焚毁。");
    } finally {
      setLoading(false);
    }
  };

  const handleBurn = async () => {
    await postJson(`/api/offline-secrets/${secretId}/burn`, { readToken });
    setPlaintext("");
    setOpened(null);
    setMeta((current) => (current ? { ...current, status: "burned", burnedAt: Date.now() } : current));
    setError("密信已焚毁。");
  };

  return (
    <div className="border border-line bg-panel/90">
      <PanelHeader icon={<Eye className="size-5 text-brand" />} title="阅读密信" />
      <div className="space-y-5 p-5">
        {meta ? (
          <div className="grid gap-3 border border-line bg-message p-4 text-xs text-dim sm:grid-cols-2">
            <InfoRow label="状态" value={meta.status === "reading" ? "已阅读，倒计时中" : "未阅读"} />
            <InfoRow label="未读过期" value={formatDateTime(meta.unreadExpireAt)} />
          </div>
        ) : null}

        {plaintext && visibleSecret ? (
          <>
            <div className="border border-brand/20 bg-brand/5 p-4">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-bright">{plaintext}</p>
            </div>
            {remaining !== undefined ? (
              <div className="flex items-center gap-3">
                <div className="h-1 flex-1 bg-line">
                  <div
                    className="h-full bg-danger"
                    style={{ width: `${Math.max(0, Math.min(100, (remaining / (visibleSecret.readTtlMs || 30000)) * 100))}%` }}
                  />
                </div>
                <span className="w-16 text-right text-xs tabular-nums text-danger">{(remaining / 1000).toFixed(1)}s</span>
              </div>
            ) : null}
            <button
              onClick={handleBurn}
              className="flex w-full items-center justify-center gap-2 border border-danger/40 px-4 py-3 text-sm font-bold uppercase tracking-[2px] text-danger transition-colors hover:bg-danger/10"
            >
              <Flame className="size-4" />
              立即焚毁
            </button>
          </>
        ) : (
          <>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[2px] text-dim">阅读口令</span>
              <input
                type="password"
                value={passcode}
                onChange={(event) => setPasscode(event.target.value)}
                className="w-full border border-line bg-message px-4 py-3 text-sm text-bright outline-none transition-colors placeholder:text-mute focus:border-brand/70"
                placeholder="输入发送者给你的阅读口令"
              />
            </label>
            <button
              onClick={handleOpen}
              disabled={!passcode.trim() || loading}
              className="flex w-full items-center justify-center gap-2 bg-brand px-4 py-3 text-sm font-bold uppercase tracking-[2px] text-ink transition-colors hover:bg-[#00a88f] disabled:cursor-not-allowed disabled:opacity-30"
            >
              {loading ? <span className="size-4 animate-spin border-2 border-ink/30 border-t-ink" /> : <Lock className="size-4" />}
              点击查看并启动焚毁
            </button>
          </>
        )}

        {error ? <p className="text-xs leading-relaxed text-danger">{error}</p> : null}
        <p className="flex items-start gap-2 text-xs leading-relaxed text-mute">
          <Shield className="mt-0.5 size-3.5 shrink-0" />
          只有点击查看后才会解密到本机；服务器不保存明文和阅读口令。
        </p>
      </div>
    </div>
  );
}

function PanelHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-5 py-4">
      <div className="flex size-10 items-center justify-center border border-brand/30 bg-brand/5">{icon}</div>
      <div>
        <h1 className="text-lg font-bold uppercase tracking-[2px] text-bright">{title}</h1>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-mute">
          <Clock className="size-3" />
          支持离线留言和阅后即焚
        </p>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs uppercase tracking-[2px] text-mute">{label}</p>
      <p className="break-all text-sm text-bright">{value}</p>
    </div>
  );
}

function OptionGroup<T extends number>({
  title,
  options,
  value,
  onChange
}: {
  title: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[2px] text-dim">{title}</p>
      <div className="flex border border-line">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex-1 border px-3 py-2 text-xs transition-colors ${
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
