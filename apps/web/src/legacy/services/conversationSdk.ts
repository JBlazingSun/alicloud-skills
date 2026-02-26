import type { RpcClient } from '../lib/rpcClient';
import type { RoomSnapshot, Thread } from '../types';
import type { ConversationType } from '../features/conversation/types';

export type AdapterProfileMode = 'native' | 'compatibility';
export const CONVERSATION_ACTION_KEYS = [
  'listThreads',
  'listLoadedThreads',
  'startThread',
  'subscribeRoom',
  'unsubscribeRoom',
  'claimRoom',
  'releaseRoom',
  'startTurn',
  'respondApproval',
] as const;
export type ConversationActionKey = (typeof CONVERSATION_ACTION_KEYS)[number];

export type ConversationProfile = {
  mode: AdapterProfileMode;
  methods: Record<ConversationActionKey, string[]>;
};

export type ConversationDiagnostics = {
  profileMode: AdapterProfileMode;
  resolvedMethods: Record<ConversationActionKey, string | null>;
};

const NATIVE_PROFILE: ConversationProfile = {
  mode: 'native',
  methods: {
    listThreads: ['thread/list'],
    listLoadedThreads: ['thread/loaded/list'],
    startThread: ['thread/start'],
    subscribeRoom: ['room/subscribe'],
    unsubscribeRoom: ['room/unsubscribe'],
    claimRoom: ['room/claim'],
    releaseRoom: ['room/release'],
    startTurn: ['turn/start'],
    respondApproval: ['codex/request/respond'],
  },
};

const COMPAT_PROFILE: ConversationProfile = {
  mode: 'compatibility',
  methods: {
    listThreads: ['thread/list'],
    listLoadedThreads: ['thread/loaded/list'],
    startThread: ['thread/start'],
    subscribeRoom: ['room/subscribe'],
    unsubscribeRoom: ['room/unsubscribe'],
    claimRoom: ['room/claim'],
    releaseRoom: ['room/release'],
    startTurn: ['conversation/sendMessage', 'turn/start'],
    respondApproval: ['codex/request/respond'],
  },
};

function cloneProfile(profile: ConversationProfile): ConversationProfile {
  return {
    mode: profile.mode,
    methods: Object.fromEntries(
      CONVERSATION_ACTION_KEYS.map((key) => [key, [...profile.methods[key]]])
    ) as ConversationProfile['methods'],
  };
}

const conversationProfileRegistry = new Map<ConversationType, ConversationProfile>();

export function registerConversationProfile(type: ConversationType, profile: ConversationProfile): void {
  conversationProfileRegistry.set(type, cloneProfile(profile));
}

export function resolveConversationProfile(type: ConversationType): ConversationProfile {
  const fallback = type === 'codex' ? NATIVE_PROFILE : COMPAT_PROFILE;
  return cloneProfile(conversationProfileRegistry.get(type) ?? fallback);
}

async function requestWithResolution<T>(
  rpc: RpcClient,
  action: ConversationActionKey,
  methods: string[],
  resolvedMethods: Record<ConversationActionKey, string | null>,
  paramsBuilder: (method: string) => unknown
): Promise<T> {
  let lastError: unknown;
  const preferredMethod = resolvedMethods[action];
  const queue: string[] = [];
  if (preferredMethod && methods.includes(preferredMethod)) {
    queue.push(preferredMethod);
  }
  for (const method of methods) {
    if (method !== preferredMethod) queue.push(method);
  }

  for (const method of queue) {
    try {
      const result = await rpc.request<T>(method, paramsBuilder(method));
      resolvedMethods[action] = method;
      return result;
    } catch (error) {
      if (resolvedMethods[action] === method) {
        resolvedMethods[action] = null;
      }
      lastError = error;
    }
  }
  throw lastError ?? new Error('All conversation sdk fallback methods failed');
}

export class ConversationSdk {
  private readonly profile: ConversationProfile;
  private readonly resolvedMethods: Record<ConversationActionKey, string | null>;

  constructor(
    private readonly rpc: RpcClient,
    readonly type: ConversationType
  ) {
    this.profile = resolveConversationProfile(type);
    this.resolvedMethods = Object.fromEntries(
      CONVERSATION_ACTION_KEYS.map((key) => [key, null])
    ) as Record<ConversationActionKey, string | null>;
  }

  get profileMode(): AdapterProfileMode {
    return this.profile.mode;
  }

  getDiagnostics(): ConversationDiagnostics {
    return {
      profileMode: this.profile.mode,
      resolvedMethods: { ...this.resolvedMethods },
    };
  }

  async listThreads(loadedOnly: boolean, cursor?: string | null): Promise<{ threads: Thread[]; nextCursor: string | null }> {
    const action: ConversationActionKey = loadedOnly ? 'listLoadedThreads' : 'listThreads';
    const methods = loadedOnly ? this.profile.methods.listLoadedThreads : this.profile.methods.listThreads;
    const res = await requestWithResolution<{ threads: Thread[]; nextCursor?: string }>(
      this.rpc,
      action,
      methods,
      this.resolvedMethods,
      () => ({ cursor: cursor ?? undefined })
    );
    return {
      threads: res.threads ?? [],
      nextCursor: res.nextCursor ?? null,
    };
  }

  async startThread(): Promise<{ threadId: string; thread?: Thread }> {
    const res = await requestWithResolution<{ threadId?: string; thread?: Thread }>(
      this.rpc,
      'startThread',
      this.profile.methods.startThread,
      this.resolvedMethods,
      () => ({})
    );
    const threadId = res.threadId ?? res.thread?.id ?? '';
    if (!threadId) throw new Error('thread/start failed: missing threadId');
    return { threadId, thread: res.thread };
  }

  subscribeRoom(threadId: string, cursor?: number): Promise<RoomSnapshot> {
    return requestWithResolution<RoomSnapshot>(
      this.rpc,
      'subscribeRoom',
      this.profile.methods.subscribeRoom,
      this.resolvedMethods,
      () => ({ threadId, cursor })
    );
  }

  async unsubscribeRoom(threadId: string): Promise<void> {
    await requestWithResolution(
      this.rpc,
      'unsubscribeRoom',
      this.profile.methods.unsubscribeRoom,
      this.resolvedMethods,
      () => ({ threadId })
    );
  }

  claimRoom(threadId: string): Promise<{ ownerClientId: string | null; ttlMs: number }> {
    return requestWithResolution(
      this.rpc,
      'claimRoom',
      this.profile.methods.claimRoom,
      this.resolvedMethods,
      () => ({ threadId })
    );
  }

  releaseRoom(threadId: string): Promise<{ ownerClientId: string | null }> {
    return requestWithResolution(
      this.rpc,
      'releaseRoom',
      this.profile.methods.releaseRoom,
      this.resolvedMethods,
      () => ({ threadId })
    );
  }

  async startTurn(threadId: string, text: string, cwd?: string): Promise<void> {
    await requestWithResolution(
      this.rpc,
      'startTurn',
      this.profile.methods.startTurn,
      this.resolvedMethods,
      (method) =>
        method === 'conversation/sendMessage'
          ? {
              conversation_id: threadId,
              input: text,
              msg_id: `ui-${Date.now()}`,
              cwd,
            }
          : { threadId, content: [{ type: 'text', text }], cwd }
    );
  }

  async respondApproval(requestId: string | number, result: unknown): Promise<void> {
    await requestWithResolution(
      this.rpc,
      'respondApproval',
      this.profile.methods.respondApproval,
      this.resolvedMethods,
      () => ({ requestId, result })
    );
  }
}

export const createConversationSdk = (rpc: RpcClient, type: ConversationType) =>
  new ConversationSdk(rpc, type);
