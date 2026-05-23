import { useState } from 'react';
import { Shield, EyeOff, Lock, ChevronRight } from 'lucide-react';
import { useRoomStore } from '@/store/useRoomStore';

export function JoinRoomForm() {
  const [room, setRoom] = useState('');
  const [pass, setPass] = useState('');
  const joinRoom = useRoomStore((s) => s.joinRoom);
  const roomState = useRoomStore((s) => s.roomState);
  const isJoining = roomState === 'joining';

  const canSubmit = room.trim().length > 0 && pass.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit && !isJoining) {
      joinRoom(room.trim(), pass.trim());
    }
  };

  return (
    <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm sm:max-w-md">
        {/* Header */}
        <div className="mb-8 sm:mb-10 text-center">
          <div className="mb-4 sm:mb-5 flex justify-center">
            <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center border border-[#008F7A]/40 bg-[#008F7A]/10">
              <Shield className="h-6 w-6 sm:h-7 sm:w-7 text-[#008F7A]" strokeWidth={1.5} />
            </div>
          </div>
          <h1
            className="mb-2 sm:mb-3 text-xl sm:text-2xl font-bold tracking-wider text-[#E0E0E0] uppercase"
            style={{ letterSpacing: '3px' }}
          >
            暗号房
          </h1>
          <p className="text-xs sm:text-sm text-[#008F7A] tracking-wider font-semibold uppercase mb-2">
            Secret Room
          </p>
          <p className="text-xs sm:text-sm text-[#888888] leading-relaxed px-2">
            输入相同暗号，唤醒一个临时密聊房间
          </p>
          <p className="text-[10px] sm:text-xs text-[#666666] mt-2 leading-relaxed px-4">
            无需账号，无头像，无昵称。两端进入后，消息只在浏览器中解密。
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
          <div>
            <label className="block text-[10px] sm:text-xs text-[#888888] uppercase tracking-wider mb-1.5 sm:mb-2 font-semibold">
              房间号
            </label>
            <input
              type="text"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="输入房间号"
              className="w-full bg-[#0a0a0a] border border-[#222222] text-[#E0E0E0] px-4 py-2.5 sm:py-3 text-sm placeholder-[#444444] focus:outline-none focus:border-[#008F7A]/60 transition-colors"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div>
            <label className="block text-[10px] sm:text-xs text-[#888888] uppercase tracking-wider mb-1.5 sm:mb-2 font-semibold">
              房间口令
            </label>
            <div className="relative">
              <input
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="输入房间口令"
                className="w-full bg-[#0a0a0a] border border-[#222222] text-[#E0E0E0] px-4 py-2.5 sm:py-3 text-sm placeholder-[#444444] focus:outline-none focus:border-[#008F7A]/60 transition-colors pr-10"
                autoComplete="off"
                spellCheck={false}
              />
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#444444]" />
            </div>
          </div>

          <button
            type="submit"
            disabled={!canSubmit || isJoining}
            className="w-full flex items-center justify-center gap-2 bg-[#008F7A] text-[#050505] py-3 sm:py-3.5 text-xs sm:text-sm font-bold uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#00a88f] transition-colors"
          >
            {isJoining ? (
              <>
                <div className="h-4 w-4 border-2 border-[#050505]/30 border-t-[#050505] animate-spin" />
                正在唤醒...
              </>
            ) : (
              <>
                唤醒房间
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        {/* Security notes */}
        <div className="mt-6 sm:mt-8 space-y-2.5 sm:space-y-3 border-t border-[#1a1a1a] pt-5 sm:pt-6">
          <div className="flex items-start gap-2.5">
            <Lock className="h-3.5 w-3.5 text-[#666666] mt-0.5 shrink-0" />
            <p className="text-xs text-[#666666] leading-relaxed">
              服务端不保存明文
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <EyeOff className="h-3.5 w-3.5 text-[#666666] mt-0.5 shrink-0" />
            <p className="text-xs text-[#666666] leading-relaxed">
              IP 仅用于风险防范，不展示给任何人
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <Shield className="h-3.5 w-3.5 text-[#666666] mt-0.5 shrink-0" />
            <p className="text-xs text-[#666666] leading-relaxed">
              关闭页面后，本地消息和临时密钥将被清除
            </p>
          </div>
        </div>

        {/* Bottom warning */}
        <div className="mt-6 sm:mt-8 border border-[#D9534F]/20 bg-[#D9534F]/5 px-3 sm:px-4 py-2.5 sm:py-3">
          <p className="text-[10px] sm:text-xs text-[#D9534F]/80 text-center leading-relaxed">
            无法阻止屏幕截图或拍照，请在可信环境中使用。
          </p>
        </div>
      </div>
    </div>
  );
}
