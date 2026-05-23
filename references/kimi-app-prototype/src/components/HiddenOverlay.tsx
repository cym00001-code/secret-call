import { useRoomStore } from '@/store/useRoomStore';
import { Eye, Lock } from 'lucide-react';

export function HiddenOverlay() {
  const revealWindow = useRoomStore((s) => s.revealWindow);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{
        backgroundColor: 'rgba(5, 5, 5, 0.95)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Noise texture overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '128px 128px',
        }}
      />

      <div className="relative z-10 text-center px-4 max-w-sm">
        <div className="mb-5 flex justify-center">
          <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center border border-[#008F7A]/30 bg-[#008F7A]/5">
            <Lock className="h-5 w-5 sm:h-6 sm:w-6 text-[#008F7A]" strokeWidth={1.5} />
          </div>
        </div>

        <h3
          className="mb-2 text-base sm:text-lg font-bold tracking-wider text-[#E0E0E0] uppercase"
          style={{ letterSpacing: '2px' }}
        >
          窗口已隐藏
        </h3>

        <p className="text-xs text-[#888888] mb-8">
          聊天内容已被模糊处理
        </p>

        <button
          onClick={revealWindow}
          className="inline-flex items-center gap-2 bg-[#008F7A] text-[#050505] px-5 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-bold uppercase tracking-wider hover:bg-[#00a88f] transition-colors"
        >
          <Eye className="h-4 w-4" />
          恢复显示
        </button>
      </div>
    </div>
  );
}
