import type { RpcClient } from '../../lib/rpcClient';
import type { RoomSnapshot, Thread } from '../../types';
import type { ConversationType } from './types';
import {
  CONVERSATION_ACTION_KEYS,
  createConversationSdk,
  type AdapterProfileMode,
  type ConversationActionKey,
} from '../../services';

export const ADAPTER_ACTION_KEYS = CONVERSATION_ACTION_KEYS;
export type AdapterActionKey = ConversationActionKey;
export type AdapterDiagnostics = {
  profileMode: AdapterProfileMode;
  resolvedMethods: Record<AdapterActionKey, string | null>;
};

export type ConversationAdapter = {
  type: ConversationType;
  profileMode: AdapterProfileMode;
  getDiagnostics: () => AdapterDiagnostics;
  listThreads: (loadedOnly: boolean, cursor?: string | null) => Promise<{ threads: Thread[]; nextCursor: string | null }>;
  startThread: () => Promise<{ threadId: string; thread?: Thread }>;
  subscribeRoom: (threadId: string, cursor?: number) => Promise<RoomSnapshot>;
  unsubscribeRoom: (threadId: string) => Promise<void>;
  claimRoom: (threadId: string) => Promise<{ ownerClientId: string | null; ttlMs: number }>;
  releaseRoom: (threadId: string) => Promise<{ ownerClientId: string | null }>;
  startTurn: (threadId: string, text: string, cwd?: string) => Promise<void>;
  respondApproval: (requestId: string | number, result: unknown) => Promise<void>;
};

export function createConversationAdapter(rpc: RpcClient, type: ConversationType): ConversationAdapter {
  const sdk = createConversationSdk(rpc, type);

  return {
    type,
    profileMode: sdk.profileMode,
    getDiagnostics() {
      return sdk.getDiagnostics();
    },
    listThreads(loadedOnly, cursor) {
      return sdk.listThreads(loadedOnly, cursor);
    },
    startThread() {
      return sdk.startThread();
    },
    subscribeRoom(threadId, cursor) {
      return sdk.subscribeRoom(threadId, cursor);
    },
    unsubscribeRoom(threadId) {
      return sdk.unsubscribeRoom(threadId);
    },
    claimRoom(threadId) {
      return sdk.claimRoom(threadId);
    },
    releaseRoom(threadId) {
      return sdk.releaseRoom(threadId);
    },
    startTurn(threadId, text, cwd) {
      return sdk.startTurn(threadId, text, cwd);
    },
    respondApproval(requestId, result) {
      return sdk.respondApproval(requestId, result);
    },
  };
}
