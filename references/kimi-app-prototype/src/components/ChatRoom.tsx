import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, EyeOff, Trash2, Lock, Image, X } from 'lucide-react';
import { useRoomStore } from '@/store/useRoomStore';
import type { LocalMessage } from '@/types';
import { MessageBubble } from './MessageBubble';
import { BurnTimeSelector } from './BurnTimeSelector';
import { SecurityCode } from './SecurityCode';
import { DestroyRoomDialog } from './DestroyRoomDialog';
import { HiddenOverlay } from './HiddenOverlay';

const generateId = () =>
  Math.random().toString(36).substring(2, 10) +
  Date.now().toString(36).substring(4);

const MOCK_PEER_MESSAGES = [
  '你好，这是对方的测试消息',
  '我看到你的消息了',
  '这个密聊房间看起来很安全',
  '消息会在30秒后自动销毁',
  '倒计时已经开始了吗？',
];

// Pre-generated mock images for peer (colored rectangles as data URLs)
const MOCK_PEER_IMAGES = [
  'https://picsum.photos/seed/secret1/400/300',
  'https://picsum.photos/seed/secret2/400/300',
];

export function ChatRoom() {
  const roomState = useRoomStore((s) => s.roomState);
  const messages = useRoomStore((s) => s.messages);
  const addMessage = useRoomStore((s) => s.addMessage);
  const selectedBurnTime = useRoomStore((s) => s.selectedBurnTime);
  const hideWindow = useRoomStore((s) => s.hideWindow);
  const simulatePeerMessage = useRoomStore((s) => s.simulatePeerMessage);
  const simulatePeerImage = useRoomStore((s) => s.simulatePeerImage);

  const [inputText, setInputText] = useState('');
  const [showDestroyDialog, setShowDestroyDialog] = useState(false);
  const [peerMsgIndex, setPeerMsgIndex] = useState(0);
  const [peerImgIndex, setPeerImgIndex] = useState(0);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle visibility change (blur → hide)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && roomState === 'active') {
        hideWindow();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [roomState, hideWindow]);

  // Mock: simulate incoming peer messages
  const handleSimulatePeerMessage = useCallback(() => {
    if (peerMsgIndex < MOCK_PEER_MESSAGES.length) {
      simulatePeerMessage(MOCK_PEER_MESSAGES[peerMsgIndex]);
      setPeerMsgIndex((prev) => prev + 1);
    }
  }, [peerMsgIndex, simulatePeerMessage]);

  const handleSimulatePeerImage = useCallback(() => {
    if (peerImgIndex < MOCK_PEER_IMAGES.length) {
      simulatePeerImage(MOCK_PEER_IMAGES[peerImgIndex]);
      setPeerImgIndex((prev) => prev + 1);
    }
  }, [peerImgIndex, simulatePeerImage]);

  // Send text message
  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;

    const msg: LocalMessage = {
      id: generateId(),
      from: 'me',
      type: 'text',
      text: trimmed,
      burnAfterMs: selectedBurnTime,
      status: 'pending',
    };

    addMessage(msg);
    setInputText('');
    inputRef.current?.focus();

    // Mock: simulate peer response
    setTimeout(() => {
      if (Math.random() > 0.5) {
        handleSimulatePeerMessage();
      }
    }, 1500 + Math.random() * 2000);
  };

  // Handle image file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const imageUrl = ev.target?.result as string;
      if (imageUrl) {
        setPreviewImage(imageUrl);
      }
    };
    reader.readAsDataURL(file);

    // Reset file input
    e.target.value = '';
  };

  // Send image message
  const handleSendImage = () => {
    if (!previewImage) return;

    const msg: LocalMessage = {
      id: generateId(),
      from: 'me',
      type: 'image',
      text: '[图片]',
      imageUrl: previewImage,
      burnAfterMs: selectedBurnTime,
      status: 'pending',
    };

    addMessage(msg);
    setPreviewImage(null);

    // Mock: simulate peer image response
    setTimeout(() => {
      if (Math.random() > 0.3) {
        handleSimulatePeerImage();
      }
    }, 2000 + Math.random() * 1500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (roomState === 'hidden') {
    return <HiddenOverlay />;
  }

  return (
    <div className="relative z-10 flex flex-col h-[100dvh] overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 border-b border-[#1a1a1a] bg-[#0a0a0a]/90 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-3 py-2 md:px-4 md:py-2.5">
          {/* Status row */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-1.5 w-1.5 bg-[#008F7A] animate-pulse shrink-0" />
              <span className="text-[10px] text-[#008F7A] uppercase tracking-wider font-semibold truncate">
                已唤醒
              </span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-3">
              <button
                onClick={hideWindow}
                className="flex items-center gap-1 sm:gap-1.5 border border-[#333333] px-2 py-1.5 sm:px-2.5 text-[10px] text-[#888888] uppercase tracking-wider hover:border-[#008F7A]/40 hover:text-[#008F7A] transition-colors"
                title="隐藏窗口"
              >
                <EyeOff className="h-3 w-3" />
                <span className="hidden sm:inline">隐藏</span>
              </button>
              <button
                onClick={() => setShowDestroyDialog(true)}
                className="flex items-center gap-1 sm:gap-1.5 border border-[#D9534F]/40 px-2 py-1.5 sm:px-2.5 text-[10px] text-[#D9534F] uppercase tracking-wider hover:bg-[#D9534F]/10 transition-colors"
                title="销毁房间"
              >
                <Trash2 className="h-3 w-3" />
                <span className="hidden sm:inline">销毁</span>
              </button>
            </div>
          </div>

          {/* Security code */}
          <SecurityCode />
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto scrollbar-hide min-h-0">
        <div className="max-w-3xl mx-auto px-3 py-4 md:px-4 md:py-6 space-y-3 sm:space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 sm:py-20 text-center">
              <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center border border-[#222222] mb-4">
                <Lock className="h-4 w-4 sm:h-5 sm:w-5 text-[#333333]" />
              </div>
              <p className="text-xs text-[#444444] uppercase tracking-wider mb-1">
                密聊已就绪
              </p>
              <p className="text-[10px] text-[#333333]">
                发送消息或图片开始对话
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Mock controls for demo */}
          {messages.length > 0 && (
            <div className="flex justify-center gap-2 pt-2">
              <button
                onClick={handleSimulatePeerMessage}
                className="text-[10px] text-[#333333] uppercase tracking-wider border border-[#222222] px-3 py-1 hover:border-[#444444] hover:text-[#555555] transition-colors"
              >
                [模拟] 对方发文字
              </button>
              <button
                onClick={handleSimulatePeerImage}
                className="text-[10px] text-[#333333] uppercase tracking-wider border border-[#222222] px-3 py-1 hover:border-[#444444] hover:text-[#555555] transition-colors"
              >
                [模拟] 对方发图片
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Image preview overlay */}
      {previewImage && (
        <div className="shrink-0 border-t border-[#008F7A]/30 bg-[#0a0a0a] px-3 py-2 md:px-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-[#008F7A] uppercase tracking-wider font-semibold shrink-0">
                图片预览
              </span>
              <div className="flex-1 overflow-hidden">
                <img
                  src={previewImage}
                  alt="preview"
                  className="h-16 sm:h-20 w-auto object-contain border border-[#222222]"
                />
              </div>
              <button
                onClick={() => setPreviewImage(null)}
                className="shrink-0 text-[#888888] hover:text-[#D9534F] transition-colors p-1"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                onClick={handleSendImage}
                className="shrink-0 flex items-center gap-1 bg-[#008F7A] text-[#050505] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider hover:bg-[#00a88f] transition-colors"
              >
                <Send className="h-3 w-3" />
                发送
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom input area */}
      <div className="shrink-0 border-t border-[#1a1a1a] bg-[#0a0a0a]/90 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-3 py-2.5 sm:py-3 md:px-4 md:py-4">
          {/* Burn time selector */}
          <div className="mb-2 sm:mb-3">
            <BurnTimeSelector />
          </div>

          {/* Input row */}
          <div className="flex items-end gap-2">
            {/* Image upload button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 flex items-center justify-center border border-[#333333] text-[#888888] p-2 sm:px-2.5 sm:py-2 hover:border-[#008F7A]/40 hover:text-[#008F7A] transition-colors"
              title="发送图片"
            >
              <Image className="h-4 w-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />

            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入加密消息..."
              className="flex-1 bg-transparent border-b border-[#008F7A]/30 text-[#E0E0E0] px-0 py-2 sm:py-2.5 text-sm placeholder-[#444444] focus:outline-none focus:border-[#008F7A] transition-colors min-w-0"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              className="shrink-0 flex items-center gap-1 bg-[#008F7A] text-[#050505] px-3 py-2 sm:px-4 sm:py-2.5 text-xs font-bold uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#00a88f] transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">发送</span>
            </button>
          </div>

          {/* Hint */}
          <p className="mt-1.5 sm:mt-2 text-[10px] text-[#444444]">
            对方查看后开始倒计时 · 当前{(selectedBurnTime / 1000)}秒
          </p>
        </div>
      </div>

      {/* Destroy dialog */}
      <DestroyRoomDialog
        open={showDestroyDialog}
        onClose={() => setShowDestroyDialog(false)}
      />
    </div>
  );
}
