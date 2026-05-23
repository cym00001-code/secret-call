import { create } from 'zustand';
import type {
  RoomState,
  LocalMessage,
  SecurityCode,
  BurnTimeOption,
} from '@/types';

interface RoomStore {
  // Core state
  roomState: RoomState;
  roomNumber: string;
  passphrase: string;
  securityCode: SecurityCode | null;
  messages: LocalMessage[];
  selectedBurnTime: BurnTimeOption;
  isFocused: boolean;
  connectionId: string | null;

  // Actions
  setRoomState: (state: RoomState) => void;
  setRoomNumber: (room: string) => void;
  setPassphrase: (pass: string) => void;
  setSecurityCode: (code: SecurityCode | null) => void;
  setSelectedBurnTime: (time: BurnTimeOption) => void;
  setIsFocused: (focused: boolean) => void;
  setConnectionId: (id: string | null) => void;

  // Message actions
  addMessage: (msg: LocalMessage) => void;
  markMessageSeen: (msgId: string) => void;
  markMessageBurning: (msgId: string) => void;
  burnMessage: (msgId: string) => void;
  clearMessages: () => void;

  // Room lifecycle
  reset: () => void;
  joinRoom: (roomNumber: string, passphrase: string) => void;
  leaveRoom: () => void;
  destroyRoom: () => void;
  hideWindow: () => void;
  revealWindow: () => void;
  simulatePeerJoin: () => void;
  simulatePeerMessage: (text: string) => void;
  simulatePeerImage: (imageUrl: string) => void;
}

const generateId = () =>
  Math.random().toString(36).substring(2, 10) +
  Date.now().toString(36).substring(4);

const generateSecurityCode = (): SecurityCode => {
  const emojis = ['🦊', '🌙', '🧊', '🔮', '⚡', '🗝', '🛡', '🔒', '👁', '🌑'];
  const hex = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 16).toString(16).toUpperCase()
  ).join('');
  const shuffled = [...emojis].sort(() => Math.random() - 0.5);
  return {
    emojis: `${shuffled[0]} ${shuffled[1]} ${shuffled[2]}`,
    hex,
  };
};

const initialState = {
  roomState: 'idle' as RoomState,
  roomNumber: '',
  passphrase: '',
  securityCode: null as SecurityCode | null,
  messages: [] as LocalMessage[],
  selectedBurnTime: 30000 as BurnTimeOption,
  isFocused: true,
  connectionId: null as string | null,
};

export const useRoomStore = create<RoomStore>((set, get) => ({
  ...initialState,

  setRoomState: (state) => set({ roomState: state }),
  setRoomNumber: (room) => set({ roomNumber: room }),
  setPassphrase: (pass) => set({ passphrase: pass }),
  setSecurityCode: (code) => set({ securityCode: code }),
  setSelectedBurnTime: (time) => set({ selectedBurnTime: time }),
  setIsFocused: (focused) => set({ isFocused: focused }),
  setConnectionId: (id) => set({ connectionId: id }),

  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

  markMessageSeen: (msgId) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === msgId && m.from === 'peer'
          ? { ...m, status: 'burning' as const, seenAt: Date.now() }
          : m
      ),
    })),

  markMessageBurning: (msgId) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === msgId ? { ...m, status: 'burning' as const } : m
      ),
    })),

  burnMessage: (msgId) =>
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== msgId),
    })),

  clearMessages: () => set({ messages: [] }),

  reset: () => {
    set(initialState);
  },

  joinRoom: (roomNumber, passphrase) => {
    set({
      roomNumber,
      passphrase,
      roomState: 'joining',
      connectionId: generateId(),
    });

    // Simulate joining process
    setTimeout(() => {
      const current = get();
      if (current.roomState === 'joining') {
        set({
          roomState: 'waiting',
          securityCode: generateSecurityCode(),
        });
      }
    }, 1500);
  },

  leaveRoom: () => {
    set(initialState);
  },

  destroyRoom: () => {
    set({
      roomState: 'destroyed',
      messages: [],
      securityCode: null,
    });
  },

  hideWindow: () => {
    if (get().roomState === 'active') {
      set({ roomState: 'hidden' });
    }
  },

  revealWindow: () => {
    if (get().roomState === 'hidden') {
      set({ roomState: 'active' });
    }
  },

  // Mock: simulate peer joining the room
  simulatePeerJoin: () => {
    set({ roomState: 'active' });
  },

  // Mock: simulate receiving a text message from peer
  simulatePeerMessage: (text) => {
    const msg: LocalMessage = {
      id: generateId(),
      from: 'peer',
      type: 'text',
      text,
      burnAfterMs: get().selectedBurnTime,
      status: 'visible',
    };
    set((state) => ({
      messages: [...state.messages, msg],
    }));
  },

  // Mock: simulate receiving an image from peer
  simulatePeerImage: (imageUrl: string) => {
    const msg: LocalMessage = {
      id: generateId(),
      from: 'peer',
      type: 'image',
      text: '[图片]',
      imageUrl,
      burnAfterMs: get().selectedBurnTime,
      status: 'visible',
    };
    set((state) => ({
      messages: [...state.messages, msg],
    }));
  },
}));
