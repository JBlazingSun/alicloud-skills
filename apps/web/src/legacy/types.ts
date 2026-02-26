export type Role = 'user' | 'assistant' | string;

export interface ThreadItem {
  id: string;
  threadId: string;
  role?: Role;
  content?: string;
  createdAt?: string;
  cursor: number;
  turnId?: string;
  raw?: unknown;
}

export interface Thread {
  id: string;
  title?: string;
  createdAt?: string;
}

export interface RoomSnapshot {
  snapshot: ThreadItem[];
  cursor: number;
  ownerClientId: string | null;
  ttlMs: number;
}
