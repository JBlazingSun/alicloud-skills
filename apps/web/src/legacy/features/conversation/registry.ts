import type { RpcClient } from '../../lib/rpcClient';
import { createConversationAdapter, type ConversationAdapter } from './adapter';
import { ensureConversationProfilesRegistered } from './profiles';
import type { ConversationType } from './types';

export type ConversationAdapterFactory = (rpc: RpcClient, type: ConversationType) => ConversationAdapter;

const registry = new Map<ConversationType, ConversationAdapterFactory>();

export function registerConversationAdapter(type: ConversationType, factory: ConversationAdapterFactory): void {
  registry.set(type, factory);
}

export function resolveConversationAdapter(rpc: RpcClient, type: ConversationType): ConversationAdapter {
  ensureConversationProfilesRegistered();
  const factory = registry.get(type);
  if (factory) return factory(rpc, type);
  return createConversationAdapter(rpc, type);
}
