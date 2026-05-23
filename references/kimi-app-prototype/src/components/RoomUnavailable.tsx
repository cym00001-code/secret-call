import { useRoomStore } from '@/store/useRoomStore';
import { AlertCircle, ArrowLeft } from 'lucide-react';

export function RoomUnavailable() {
  const reset = useRoomStore((s) => s.reset);

  return (
    <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm sm:max-w-md text-center">
        {/* Icon */}
        <div className="mb-5 sm:mb-6 flex justify-center">
          <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center border border-[#888888]/30 bg-[#888888]/5">
            <AlertCircle className="h-5 w-5 sm:h-6 sm:w-6 text-[#888888]" strokeWidth={1.5} />
          </div>
        </div>

        {/* Title */}
        <h2
          className="mb-2 sm:mb-3 text-base sm:text-lg font-bold tracking-wider text-[#E0E0E0] uppercase"
          style={{ letterSpacing: '2px' }}
        >
          房间暂不可用
        </h2>

        <p className="text-xs sm:text-sm text-[#888888] mb-6 sm:mb-8 leading-relaxed">
          请稍后再试，或确认你输入的信息是否正确
        </p>

        {/* Return button */}
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 border border-[#333333] text-[#888888] px-4 sm:px-5 py-2 sm:py-2.5 text-xs uppercase tracking-wider hover:border-[#008F7A]/50 hover:text-[#008F7A] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回首页
        </button>

        {/* Note */}
        <p className="mt-5 sm:mt-6 text-[10px] sm:text-xs text-[#444444]">
          无法提供更多信息。
        </p>
      </div>
    </div>
  );
}
