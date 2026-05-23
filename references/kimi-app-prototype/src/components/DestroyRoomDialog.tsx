import { useState } from 'react';
import { AlertTriangle, X, Trash2 } from 'lucide-react';
import { useRoomStore } from '@/store/useRoomStore';

interface DestroyRoomDialogProps {
  open: boolean;
  onClose: () => void;
}

export function DestroyRoomDialog({ open, onClose }: DestroyRoomDialogProps) {
  const destroyRoom = useRoomStore((s) => s.destroyRoom);
  const [confirmText, setConfirmText] = useState('');
  const canDestroy = confirmText === '销毁';

  const handleDestroy = () => {
    if (canDestroy) {
      destroyRoom();
      setConfirmText('');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-sm border border-[#D9534F]/30 bg-[#0a0a0a]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#D9534F]/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#D9534F]" />
            <span className="text-sm font-bold text-[#D9534F] uppercase tracking-wider">
              销毁房间
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[#666666] hover:text-[#E0E0E0] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-sm text-[#E0E0E0] leading-relaxed">
            此操作将立即销毁当前房间，双方的所有消息将被清除，且不可恢复。
          </p>

          <p className="text-xs text-[#888888] leading-relaxed">
            请在下方输入"销毁"以确认此操作。
          </p>

          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder='输入"销毁"确认'
            className="w-full bg-[#111111] border border-[#D9534F]/30 text-[#E0E0E0] px-4 py-2.5 text-sm placeholder-[#444444] focus:outline-none focus:border-[#D9534F]/60 transition-colors"
            autoFocus
          />
        </div>

        {/* Actions */}
        <div className="flex border-t border-[#222222]">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-xs text-[#888888] uppercase tracking-wider hover:bg-[#151515] transition-colors border-r border-[#222222]"
          >
            取消
          </button>
          <button
            onClick={handleDestroy}
            disabled={!canDestroy}
            className="flex-1 py-3 text-xs text-[#D9534F] uppercase tracking-wider font-bold hover:bg-[#D9534F]/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            确认销毁
          </button>
        </div>
      </div>
    </div>
  );
}
