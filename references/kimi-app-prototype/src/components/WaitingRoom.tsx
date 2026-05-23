import { useEffect, useState } from 'react';
import { Radio, ArrowLeft } from 'lucide-react';
import { useRoomStore } from '@/store/useRoomStore';

export function WaitingRoom() {
  const leaveRoom = useRoomStore((s) => s.leaveRoom);
  const simulatePeerJoin = useRoomStore((s) => s.simulatePeerJoin);
  const securityCode = useRoomStore((s) => s.securityCode);
  const roomNumber = useRoomStore((s) => s.roomNumber);
  const [dots, setDots] = useState('.');

  // Animate dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '.' : prev + '.'));
    }, 600);
    return () => clearInterval(interval);
  }, []);

  // MOCK: Auto-simulate peer joining after 4 seconds for demo
  useEffect(() => {
    const timer = setTimeout(() => {
      simulatePeerJoin();
    }, 4000);
    return () => clearTimeout(timer);
  }, [simulatePeerJoin]);

  return (
    <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm sm:max-w-md text-center">
        {/* Signal animation */}
        <div className="mb-6 sm:mb-8 flex justify-center">
          <div className="relative">
            <div className="flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center border border-[#008F7A]/30 bg-[#008F7A]/5">
              <Radio className="h-5 w-5 sm:h-7 sm:w-7 text-[#008F7A] animate-pulse" strokeWidth={1.5} />
            </div>
            {/* Signal rings */}
            <div className="absolute inset-0 border border-[#008F7A]/10 animate-ping" style={{ animationDuration: '2s' }} />
            <div className="absolute -inset-2 sm:-inset-3 border border-[#008F7A]/5 animate-ping" style={{ animationDuration: '3s', animationDelay: '0.5s' }} />
          </div>
        </div>

        {/* Status text */}
        <h2
          className="mb-2 sm:mb-3 text-base sm:text-lg font-bold tracking-wider text-[#E0E0E0] uppercase"
          style={{ letterSpacing: '2px' }}
        >
          等待另一端唤醒房间
        </h2>

        <p className="text-xs sm:text-sm text-[#888888] mb-2">
          请让对方输入相同的房间号和口令
        </p>

        <p className="text-xs text-[#666666] mb-6 sm:mb-8">
          等待中{dots}
        </p>

        {/* Room info */}
        <div className="mb-6 sm:mb-8 border border-[#222222] bg-[#0a0a0a]/80 p-3 sm:p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] sm:text-xs text-[#666666] uppercase tracking-wider">房间号</span>
            <span className="text-xs sm:text-sm text-[#E0E0E0] font-mono">{roomNumber}</span>
          </div>
          {securityCode && (
            <div className="border-t border-[#1a1a1a] pt-2.5 sm:pt-3 mt-2.5 sm:mt-3">
              <p className="text-[10px] sm:text-xs text-[#008F7A] mb-1.5 uppercase tracking-wider font-semibold">
                安全码
              </p>
              <p className="text-xl sm:text-2xl text-[#008F7A] font-mono tracking-wider">
                {securityCode.emojis}
              </p>
              <p className="text-xs text-[#008F7A]/60 font-mono mt-1">
                {securityCode.hex}
              </p>
            </div>
          )}
        </div>

        {/* Status tag */}
        <div className="mb-6 sm:mb-8 flex justify-center">
          <span className="inline-flex items-center gap-1.5 border border-[#008F7A]/30 px-3 py-1.5 text-[10px] sm:text-xs text-[#008F7A] uppercase tracking-wider">
            <span className="h-1.5 w-1.5 rounded-full bg-[#008F7A] animate-pulse" />
            waiting
          </span>
        </div>

        {/* Leave button */}
        <button
          onClick={leaveRoom}
          className="inline-flex items-center gap-2 border border-[#333333] text-[#888888] px-4 sm:px-5 py-2 sm:py-2.5 text-xs uppercase tracking-wider hover:border-[#D9534F]/50 hover:text-[#D9534F] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          离开房间
        </button>

        {/* Security hint */}
        <p className="mt-5 sm:mt-6 text-[10px] sm:text-xs text-[#444444]">
          房间不会显示创建或加入状态。
        </p>
      </div>
    </div>
  );
}
