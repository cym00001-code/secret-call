import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useRoomStore } from '@/store/useRoomStore';

export function SecurityCode() {
  const securityCode = useRoomStore((s) => s.securityCode);
  // Default collapsed on mobile, expanded on desktop
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 640;
    }
    return true;
  });

  // Listen to resize
  useEffect(() => {
    const handleResize = () => {
      // Auto-collapse when shrinking to mobile
      if (window.innerWidth < 640) {
        setCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!securityCode) return null;

  return (
    <div className="border border-[#008F7A]/20 bg-[#008F7A]/5">
      {/* Header - always visible */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-1.5 sm:px-4 sm:py-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] text-[#008F7A] uppercase tracking-wider font-semibold shrink-0">
            安全码
          </span>
          <span className="text-xs text-[#008F7A]/70 font-mono truncate">
            {securityCode.emojis}
          </span>
          <span className="text-[10px] text-[#008F7A]/40 font-mono hidden sm:inline">
            {securityCode.hex}
          </span>
        </div>
        {collapsed ? (
          <ChevronDown className="h-3.5 w-3.5 text-[#008F7A]/50 shrink-0" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 text-[#008F7A]/50 shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {!collapsed && (
        <div className="px-3 pb-2.5 sm:px-4 sm:pb-3 border-t border-[#008F7A]/10 pt-2">
          <p className="text-xl sm:text-2xl text-[#008F7A] font-mono tracking-wider mb-1">
            {securityCode.emojis}
          </p>
          <p className="text-xs text-[#008F7A]/60 font-mono mb-2">
            {securityCode.hex}
          </p>
          <p className="text-[10px] text-[#666666] leading-relaxed">
            请通过其他可信渠道核对安全码，确保通信环境安全
          </p>
        </div>
      )}
    </div>
  );
}
