import { useEffect, useState, useCallback } from 'react';
import type { LocalMessage } from '@/types';
import { useRoomStore } from '@/store/useRoomStore';

interface MessageBubbleProps {
  message: LocalMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const markMessageSeen = useRoomStore((s) => s.markMessageSeen);
  const burnMessage = useRoomStore((s) => s.burnMessage);
  const markMessageBurning = useRoomStore((s) => s.markMessageBurning);
  const isMe = message.from === 'me';
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Simulate peer "seeing" the message after a delay
  useEffect(() => {
    if (!isMe && message.status === 'visible') {
      const timer = setTimeout(() => {
        markMessageSeen(message.id);
      }, 800 + Math.random() * 1200);
      return () => clearTimeout(timer);
    }
  }, [isMe, message.status, message.id, markMessageSeen]);

  // Handle burning countdown
  useEffect(() => {
    if (message.status !== 'burning') return;

    const expireAt = message.seenAt! + message.burnAfterMs;
    markMessageBurning(message.id);

    const interval = setInterval(() => {
      const remaining = Math.max(0, expireAt - Date.now());
      setTimeLeft(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        setIsVisible(false);
        setTimeout(() => {
          burnMessage(message.id);
        }, 800);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [message.status, message.seenAt, message.burnAfterMs, message.id, burnMessage, markMessageBurning]);

  const formatTime = useCallback((ms: number) => {
    if (ms <= 0) return '0.0';
    return (ms / 1000).toFixed(1);
  }, []);

  if (!isVisible) {
    return (
      <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
        <div className="max-w-[85%] sm:max-w-[80%] border border-[#D9534F]/20 bg-[#D9534F]/5 px-4 py-2 animate-pulse">
          <p className="text-xs text-[#D9534F]/70 font-mono uppercase tracking-wider">
            消息已焚毁
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] sm:max-w-[80%] ${
          isMe
            ? 'bg-msg border-l-2 border-[#008F7A]'
            : 'bg-msg'
        } px-3 py-2.5 sm:px-4 sm:py-3 transition-all`}
      >
        {/* Identity label */}
        <p
          className={`text-[10px] uppercase tracking-widest mb-1.5 font-semibold ${
            isMe ? 'text-[#008F7A]' : 'text-[#888888]'
          }`}
        >
          {isMe ? '你' : '对方'}
        </p>

        {/* Message content — text or image */}
        {message.type === 'image' && message.imageUrl ? (
          <div className="relative">
            {!imgLoaded && (
              <div className="w-full h-32 sm:h-40 bg-[#1a1a1a] flex items-center justify-center mb-2">
                <div className="h-5 w-5 border-2 border-[#333333] border-t-[#008F7A] animate-spin" />
              </div>
            )}
            <img
              src={message.imageUrl}
              alt="encrypted"
              className={`max-w-full max-h-[200px] sm:max-h-[250px] object-contain bg-[#0a0a0a] ${
                imgLoaded ? 'block' : 'hidden'
              }`}
              onLoad={() => setImgLoaded(true)}
            />
          </div>
        ) : (
          <p className="text-sm text-[#E0E0E0] leading-relaxed break-words">
            {message.text}
          </p>
        )}

        {/* Burn timer */}
        {message.status === 'burning' && timeLeft !== null && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-[2px] flex-1 bg-[#222222] overflow-hidden">
              <div
                className="h-full bg-[#D9534F] transition-all"
                style={{
                  width: `${(timeLeft / message.burnAfterMs) * 100}%`,
                }}
              />
            </div>
            <span className="text-[10px] text-[#D9534F] font-mono tabular-nums">
              {formatTime(timeLeft)}s
            </span>
          </div>
        )}

        {message.status === 'pending' && (
          <p className="text-[10px] text-[#444444] mt-1.5 uppercase tracking-wider">
            等待对方查看
          </p>
        )}

        {message.status === 'visible' && !isMe && (
          <p className="text-[10px] text-[#008F7A]/50 mt-1.5 uppercase tracking-wider">
            未读
          </p>
        )}
      </div>
    </div>
  );
}
