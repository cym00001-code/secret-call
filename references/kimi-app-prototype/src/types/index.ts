export type RoomState =
  | 'idle'
  | 'joining'
  | 'waiting'
  | 'active'
  | 'hidden'
  | 'unavailable'
  | 'destroyed'
  | 'disconnected';

export type MessageStatus = 'pending' | 'visible' | 'burning' | 'burned';
export type MessageType = 'text' | 'image';

export interface LocalMessage {
  id: string;
  from: 'me' | 'peer';
  type: MessageType;
  text: string;
  imageUrl?: string;
  burnAfterMs: number;
  seenAt?: number;
  expireAt?: number;
  status: MessageStatus;
}

export interface SecurityCode {
  emojis: string;
  hex: string;
}

export type BurnTimeOption = 5000 | 10000 | 30000 | 60000;

export const BURN_TIME_OPTIONS: { value: BurnTimeOption; label: string }[] = [
  { value: 5000, label: '5s' },
  { value: 10000, label: '10s' },
  { value: 30000, label: '30s' },
  { value: 60000, label: '60s' },
];
