export type ConversationType = 'codex' | 'acp' | 'gemini' | 'openclaw-gateway';

const CONVERSATION_TYPE_SET = new Set<ConversationType>(['codex', 'acp', 'gemini', 'openclaw-gateway']);

export function normalizeConversationType(raw: string | null | undefined): ConversationType {
  if (!raw) return 'codex';
  const lower = raw.toLowerCase();
  if (lower === 'openclaw') return 'openclaw-gateway';
  if (CONVERSATION_TYPE_SET.has(lower as ConversationType)) return lower as ConversationType;
  return 'codex';
}

export function conversationTypeFromSearch(search: string): ConversationType {
  const params = new URLSearchParams(search);
  return normalizeConversationType(params.get('agent') ?? params.get('type'));
}

export function conversationTypeToQueryValue(type: ConversationType): string {
  return type === 'openclaw-gateway' ? 'openclaw' : type;
}

export function withConversationTypeInUrl(url: URL, type: ConversationType): URL {
  url.searchParams.set('agent', conversationTypeToQueryValue(type));
  return url;
}
