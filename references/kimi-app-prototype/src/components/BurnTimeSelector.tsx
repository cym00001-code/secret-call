import { BURN_TIME_OPTIONS } from '@/types';
import { useRoomStore } from '@/store/useRoomStore';
import { Clock } from 'lucide-react';

export function BurnTimeSelector() {
  const selected = useRoomStore((s) => s.selectedBurnTime);
  const setSelected = useRoomStore((s) => s.setSelectedBurnTime);

  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
      <Clock className="h-3.5 w-3.5 text-[#666666] shrink-0" />
      <span className="text-[10px] text-[#666666] uppercase tracking-wider font-semibold shrink-0 hidden sm:inline">
        阅后即焚
      </span>
      <div className="flex border border-[#222222] shrink-0">
        {BURN_TIME_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => setSelected(option.value)}
            className={`px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-mono transition-colors ${
              selected === option.value
                ? 'bg-[#008F7A]/20 text-[#008F7A] border border-[#008F7A]/40'
                : 'text-[#666666] hover:text-[#888888] border border-transparent'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
