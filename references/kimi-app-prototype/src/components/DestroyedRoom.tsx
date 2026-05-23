import { useRoomStore } from '@/store/useRoomStore';
import { Trash2, ArrowLeft } from 'lucide-react';

export function DestroyedRoom() {
  const reset = useRoomStore((s) => s.reset);

  return (
    <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm sm:max-w-md text-center">
        {/* Icon */}
        <div className="mb-5 sm:mb-6 flex justify-center">
          <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center border border-[#D9534F]/30 bg-[#D9534F]/5">
            <Trash2 className="h-5 w-5 sm:h-6 sm:w-6 text-[#D9534F]" strokeWidth={1.5} />
          </div>
        </div>

        {/* Title */}
        <h2
          className="mb-2 sm:mb-3 text-base sm:text-lg font-bold tracking-wider text-[#E0E0E0] uppercase"
          style={{ letterSpacing: '2px' }}
        >
          房间已销毁
        </h2>

        <p className="text-xs sm:text-sm text-[#888888] mb-6 sm:mb-8 leading-relaxed">
          本地消息和临时会话状态已清除
        </p>

        {/* Details */}
        <div className="mb-6 sm:mb-8 border border-[#222222] bg-[#0a0a0a]/80 p-3 sm:p-4 text-left space-y-2 sm:space-y-2.5">
          <div className="flex items-start gap-2.5">
            <span className="text-[#D9534F] mt-0.5 text-xs">×</span>
            <p className="text-xs text-[#888888]">聊天记录已清除</p>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="text-[#D9534F] mt-0.5 text-xs">×</span>
            <p className="text-xs text-[#888888]">临时密钥已销毁</p>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="text-[#D9534F] mt-0.5 text-xs">×</span>
            <p className="text-xs text-[#888888]">会话状态已重置</p>
          </div>
        </div>

        {/* Return button */}
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 bg-[#008F7A] text-[#050505] px-5 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-bold uppercase tracking-wider hover:bg-[#00a88f] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回首页
        </button>

        {/* Note */}
        <p className="mt-5 sm:mt-6 text-[10px] sm:text-xs text-[#444444]">
          不提供恢复聊天记录功能。不提供重新打开历史房间功能。
        </p>
      </div>
    </div>
  );
}
