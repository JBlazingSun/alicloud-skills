import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { parse as parseToml, stringify as stringifyToml } from '@ltd/j-toml';
import { RpcClient } from '../../lib/rpcClient';
import type { ThreadItem, Thread } from '../../types';
import { type VariableVirtualListHandle } from '../shared/VariableVirtualList';
import { useDebouncedValue } from '../shared/useDebouncedValue';
import { useRpcAction } from '../shared/useRpcAction';
import { translations, type LangKey } from './i18n';
import type { AdapterActionKey, ConversationAdapter } from '../conversation/adapter';
import type { ConversationType } from '../conversation/types';
import { resolveConversationAdapter } from '../conversation/registry';
import {
  createAgentRuntimeSdk,
  createWorkspaceSdk,
  type SkillInfo,
  type WorkspaceBrowseQuery,
  type WorkspaceInfo,
  type WorktreeInfo,
} from '../../services';
import { ChatConversationPanel } from './components/ChatConversationPanel';
import { ChatsSidebar } from './components/ChatsSidebar';
import { CommandPalette, DirectoryBrowserModal, InfoModal, InputModal } from './components/Overlays';
import { SettingsAgentConfigSection } from './components/SettingsAgentConfigSection';
import { SettingsGitSection } from './components/SettingsGitSection';
import { SettingsMcpSection } from './components/SettingsMcpSection';
import { SettingsRuntimeSection } from './components/SettingsRuntimeSection';
import { SkillsCatalogContent } from './components/SkillsCatalogContent';

const WS_BASE_URL = (() => {
  const envUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (envUrl) return envUrl;
  if (typeof window === 'undefined') return 'ws://localhost:10112/ws';
  const { protocol, host, hostname, port } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  if (port === '10111') return `${wsProtocol}//${hostname}:10112/ws`;
  return `${wsProtocol}//${host}/ws`;
})();
const THREAD_QUERY_KEY = 'thread';

function isDesktopShellRuntime() {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.classList.contains('animus-desktop')) return true;
  const params = new URLSearchParams(window.location.search);
  if (params.get('desktop') === '1') return true;
  const w = window as Window & { __ANIMUS_DESKTOP__?: boolean; __TAURI_INTERNALS__?: unknown };
  if (w.__ANIMUS_DESKTOP__) return true;
  if (w.__TAURI_INTERNALS__) return true;
  return navigator.userAgent.includes('Tauri');
}

function isMobileUserAgent() {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
}

type TabKey = 'chats' | 'skills' | 'apps' | 'settings';

type Command = {
  id: string;
  label: string;
  detail?: string;
  action: () => void;
};

type SettingsPayload = {
  version: number;
  personalization: { personality: string; instructions: string };
  automation: { auto_subscribe: boolean; auto_claim: boolean; auto_renew: boolean };
  ui?: { show_timeline?: boolean };
  mcp: { installed: Record<string, boolean>; custom: string[] };
  git: { branch_prefix: string; force_push: boolean; commit_instructions: string; pr_instructions: string };
  runtime: { transport: 'embedded_ws' | 'stdio' };
  local: {
    projects: string[];
    active_project?: string | null;
    thread_projects?: Record<string, string>;
    recent_projects?: string[];
    favorite_projects?: string[];
  };
};

type ApprovalRequest = {
  requestId: string | number;
  method: string;
  params: unknown;
  submitting?: boolean;
};

type ApprovalAction = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

type ApprovalHistoryItem = {
  id: string;
  at: string;
  method: string;
  decision: string;
  status: 'answered' | 'timeout';
};

type InputModalKind = 'mcp' | 'project' | 'worktree' | null;
type TimelineEvent = { at: string; kind: string; detail: string };

type LegacyChatAppProps = {
  conversationType?: ConversationType;
  adapter?: ConversationAdapter;
  onConversationTypeChange?: (nextType: ConversationType) => void;
};

function formatTime(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return value as Record<string, unknown>;
}

function extractDisplayContent(item: ThreadItem): string {
  if (item.content) return item.content;
  const raw = asRecord(item.raw);
  if (Array.isArray(raw?.content)) {
    return raw.content
      .map((c) => {
        const part = asRecord(c);
        return typeof part?.text === 'string' ? part.text : '';
      })
      .join('');
  }
  if (typeof raw?.text === 'string') return raw.text;
  return '';
}

function renderMarkdown(text: string): string {
  const key = text || '';
  const cached = markdownCache.get(key);
  if (cached) return cached;
  const html = marked.parse(key, { breaks: true }) as string;
  const safe = DOMPurify.sanitize(html);
  markdownCache.set(key, safe);
  if (markdownCache.size > 500) {
    const first = markdownCache.keys().next().value as string | undefined;
    if (first) markdownCache.delete(first);
  }
  return safe;
}

const markdownCache = new Map<string, string>();
const TOML_PARSE_OPTIONS = { bigint: false, joiner: '\n' };

const DEFAULT_TOML_SAMPLE = `# 填写你默认使用的模型
model = "qwen3-max"
# 填写你默认使用的模型提供者
model_provider = "my-openai-provider"
personality = "pragmatic"
[model_providers.my-openai-provider]
name = "myname"
base_url = "http://localhost:10112/t0/openai/v1"
api_key = "your-api-key"
wire_api = "responses"
`;

function shouldShowRaw(item: ThreadItem): boolean {
  const raw = asRecord(item.raw);
  const type = item.role ?? raw?.type ?? 'item';
  if (
    [
      'reasoning',
      'webSearch',
      'web_search',
      'tool',
      'toolResult',
      'function',
      'commandExecution',
      'mcpToolCall',
      'mcpToolResult',
    ].includes(String(type))
  ) {
    return true;
  }
  const content = extractDisplayContent(item);
  return content.trim().length === 0;
}
function displayRole(item: ThreadItem, t: (key: string) => string): { label: string; variant: string } {
  const raw = asRecord(item.raw);
  const type = item.role ?? raw?.type ?? 'item';
  if (type === 'user' || type === 'userMessage') return { label: t('roleUser'), variant: 'user' };
  if (type === 'assistant' || type === 'agentMessage')
    return { label: t('roleAssistant'), variant: 'assistant' };
  if (type === 'reasoning') return { label: t('roleReasoning'), variant: 'assistant' };
  if (type === 'commandExecution') return { label: t('roleCommand'), variant: 'assistant' };
  return { label: String(type), variant: 'assistant' };
}

function formatError(err: unknown) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const record = asRecord(err);
  if (typeof record?.message === 'string') return record.message;
  if (record?.code !== undefined) return `${record.code}`;
  return 'Request failed';
}

function validateEmbeddedTensorzeroConfig(configText: string): string | null {
  const parsed = parseToml(configText || '', TOML_PARSE_OPTIONS) as Record<string, unknown>;
  const tensorzero = asRecord(parsed.tensorzero);
  const embedded =
    typeof parsed.tensorzero_config_toml === 'string'
      ? parsed.tensorzero_config_toml
      : typeof tensorzero?.config_toml === 'string'
        ? tensorzero.config_toml
        : '';
  if (!embedded.trim()) return null;
  parseToml(embedded, TOML_PARSE_OPTIONS);
  return null;
}

function hasProviderConfig(configText: string): boolean {
  if (!configText.trim()) return false;
  try {
    const parsed = parseToml(configText, TOML_PARSE_OPTIONS) as Record<string, unknown>;
    const modelProvider = typeof parsed.model_provider === 'string' ? parsed.model_provider.trim() : '';
    const modelProviders = asRecord(parsed.model_providers);
    if (modelProvider && modelProviders) {
      const target = asRecord(modelProviders[modelProvider]);
      if (target && Object.keys(target).length > 0) return true;
    }
    if (modelProviders && Object.keys(modelProviders).length > 0) return true;

    const tensorzero = asRecord(parsed.tensorzero);
    const embedded =
      typeof parsed.tensorzero_config_toml === 'string'
        ? parsed.tensorzero_config_toml
        : typeof tensorzero?.config_toml === 'string'
          ? tensorzero.config_toml
          : '';
    if (!embedded.trim()) return false;
    const embeddedParsed = parseToml(embedded, TOML_PARSE_OPTIONS) as Record<string, unknown>;
    const providers = asRecord(embeddedParsed.providers);
    return !!providers && Object.keys(providers).length > 0;
  } catch {
    return false;
  }
}

function requestIdKey(id: string | number) {
  return typeof id === 'number' ? `n:${id}` : `s:${id}`;
}

function approvalThreadId(request: ApprovalRequest): string | undefined {
  const params = asRecord(request.params) ?? {};
  const threadId = params.threadId ?? params.thread_id ?? params.conversationId ?? params.conversation_id;
  return typeof threadId === 'string' ? threadId : undefined;
}

function approvalResult(request: ApprovalRequest, action: ApprovalAction): unknown {
  if (request.method === 'item/commandExecution/requestApproval') {
    return { decision: action };
  }
  if (request.method === 'item/fileChange/requestApproval') {
    return { decision: action };
  }
  if (request.method === 'execCommandApproval' || request.method === 'applyPatchApproval') {
    const decisionByAction: Record<ApprovalAction, string> = {
      accept: 'approved',
      acceptForSession: 'approved_for_session',
      decline: 'denied',
      cancel: 'abort',
    };
    return { decision: decisionByAction[action] };
  }
  return null;
}

function estimateMessageHeight(item: ThreadItem): number {
  const content = extractDisplayContent(item);
  const raw = shouldShowRaw(item) ? JSON.stringify(item.raw ?? {}, null, 2) : '';
  const contentLines = Math.max(1, Math.ceil(content.length / 72));
  const rawLines = raw ? Math.min(18, Math.ceil(raw.length / 80)) : 0;
  return Math.min(640, 84 + contentLines * 22 + rawLines * 18);
}

function decisionText(decision: string, t: (key: string) => string) {
  const map: Record<string, string> = {
    accept: t('approveOnce'),
    acceptForSession: t('approveSession'),
    decline: t('decline'),
    cancel: t('cancel'),
  };
  return map[decision] ?? decision;
}

function turnStatusMeta(status: string): { key: string; tone: 'idle' | 'running' | 'waiting' | 'error' } {
  if (status === 'starting' || status === 'running') {
    return { key: status === 'starting' ? 'turnStarting' : 'turnRunning', tone: 'running' };
  }
  if (status === 'waiting_approval') {
    return { key: 'turnWaitingApproval', tone: 'waiting' };
  }
  if (status === 'error') {
    return { key: 'turnError', tone: 'error' };
  }
  if (status === 'completed' || status === 'finished') {
    return { key: 'turnCompleted', tone: 'idle' };
  }
  return { key: 'turnIdle', tone: 'idle' };
}

function IconSpark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3l1.6 4.7L18 9.3l-4.4 1.6L12 15l-1.6-4.1L6 9.3l4.4-1.6L12 3z"
        fill="currentColor"
      />
      <circle cx="18.5" cy="5.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm8.7 12.3-3-3A7.9 7.9 0 1 0 18 16l3 3z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="currentColor" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" fill="currentColor" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm6.9 8h-3a13.7 13.7 0 0 0-1.4-5 7 7 0 0 1 4.4 5zM12 5.1c.9 1.3 1.7 3.3 1.9 5.9h-3.8c.2-2.6 1-4.6 1.9-5.9zM5.1 13h3a13.7 13.7 0 0 0 1.4 5 7 7 0 0 1-4.4-5zm3-2h-3a7 7 0 0 1 4.4-5 13.7 13.7 0 0 0-1.4 5zm3.9 7.9c-.9-1.3-1.7-3.3-1.9-5.9h3.8c-.2 2.6-1 4.6-1.9 5.9zm2.5-.9a13.7 13.7 0 0 0 1.4-5h3a7 7 0 0 1-4.4 5z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconMore() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 6.5a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zm0 4.8a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zm0 4.8a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 5h14a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H9.6l-4.9 3.8c-.3.2-.7 0-.7-.4V7a2 2 0 0 1 2-2zm1 3v1.8h12V8H6zm0 4v1.8h8V12H6z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" fill="currentColor" />
    </svg>
  );
}

function IconCog() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 8.5A3.5 3.5 0 1 1 12 15.5 3.5 3.5 0 0 1 12 8.5zm8 3.5-.1-1.1-2.1-.6a6.7 6.7 0 0 0-.6-1.5l1.1-1.9-.8-.8-1.9 1.1c-.5-.2-1-.5-1.5-.6L13.1 3h-1.2l-.6 2.1c-.5.1-1 .3-1.5.6L8 4.6l-.8.8 1.1 1.9c-.3.5-.5 1-.6 1.5L5.6 9.4 5.5 10.6l2.1.6c.1.5.3 1 .6 1.5L7.1 14.6l.8.8 1.9-1.1c.5.3 1 .5 1.5.6l.6 2.1h1.2l.6-2.1c.5-.1 1-.3 1.5-.6l1.9 1.1.8-.8-1.1-1.9c.3-.5.5-1 .6-1.5l2.1-.6z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function App({
  conversationType = 'codex',
  adapter: injectedAdapter,
  onConversationTypeChange,
}: LegacyChatAppProps) {
  const rpc = useMemo(() => new RpcClient(), []);
  const runtimeSdk = useMemo(() => createAgentRuntimeSdk(rpc), [rpc]);
  const workspaceSdk = useMemo(() => createWorkspaceSdk(rpc), [rpc]);
  const adapter = useMemo(
    () => injectedAdapter ?? resolveConversationAdapter(rpc, conversationType),
    [conversationType, injectedAdapter, rpc]
  );
  const desktopShell = useMemo(() => isDesktopShellRuntime(), []);
  const commandModifierLabel =
    typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
  const [connected, setConnected] = useState(false);
  const [clientId, setClientId] = useState<string>('');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState('');
  const [cursor, setCursor] = useState<number>(0);
  const [ownerClientId, setOwnerClientId] = useState<string | null>(null);
  const [ttlMs, setTtlMs] = useState<number>(0);
  const [messages, setMessages] = useState<ThreadItem[]>([]);
  const [streamingText, setStreamingText] = useState<string>('');
  const [streamingItemId, setStreamingItemId] = useState<string>('');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string>('');
  const [filter, setFilter] = useState('');
  const [autoSubscribe, setAutoSubscribe] = useState(true);
  const [autoClaim, setAutoClaim] = useState(true);
  const [autoRenew, setAutoRenew] = useState(true);
  const [showTimeline, setShowTimeline] = useState(false);
  const [loadedOnly, setLoadedOnly] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [turnStatus, setTurnStatus] = useState<string>('idle');
  const [activeThreadId, setActiveThreadId] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('chats');
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(true);
  const [mobileHeaderMenuOpen, setMobileHeaderMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [lang, setLang] = useState<LangKey>('en');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string>('');
  const [skillsFilter, setSkillsFilter] = useState('');
  const debouncedThreadFilter = useDebouncedValue(filter, 120);
  const debouncedSkillsFilter = useDebouncedValue(skillsFilter, 120);
  const [personality, setPersonality] = useState<'friendly' | 'pragmatic'>('friendly');
  const [customInstructions, setCustomInstructions] = useState('');
  const [gitBranchPrefix, setGitBranchPrefix] = useState('animus/');
  const [gitForcePush, setGitForcePush] = useState(false);
  const [gitCommitInstructions, setGitCommitInstructions] = useState('');
  const [gitPrInstructions, setGitPrInstructions] = useState('');
  const [mcpInstalled, setMcpInstalled] = useState<Record<string, boolean>>({});
  const [mcpCustomServers, setMcpCustomServers] = useState<string[]>([]);
  const [localProjects, setLocalProjects] = useState<string[]>([]);
  const [activeWorkspacePath, setActiveWorkspacePath] = useState<string>('');
  const [threadWorkspaceMap, setThreadWorkspaceMap] = useState<Record<string, string>>({});
  const [recentWorkspacePaths, setRecentWorkspacePaths] = useState<string[]>([]);
  const [favoriteWorkspacePaths, setFavoriteWorkspacePaths] = useState<string[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [worktreeItems, setWorktreeItems] = useState<WorktreeInfo[]>([]);
  const [worktreeLoading, setWorktreeLoading] = useState(false);
  const [worktreeError, setWorktreeError] = useState('');
  const [codexTransport, setCodexTransport] = useState<'embedded_ws' | 'stdio'>('embedded_ws');
  const [configText, setConfigText] = useState('');
  const [configDirty, setConfigDirty] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configPath, setConfigPath] = useState('');
  const [settingsToast, setSettingsToast] = useState<string>('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalBody, setModalBody] = useState<string>('');
  const [inputModalKind, setInputModalKind] = useState<InputModalKind>(null);
  const [inputModalValue, setInputModalValue] = useState('');
  const [workspaceBrowserOpen, setWorkspaceBrowserOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [approvalHistory, setApprovalHistory] = useState<ApprovalHistoryItem[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const configLoadedRef = useRef(false);
  const settingsSaveTimer = useRef<number | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const activeThreadRef = useRef<string>('');
  const subscribingRef = useRef<string | null>(null);
  const messageListRef = useRef<VariableVirtualListHandle | null>(null);
  const [isMessageAutoFollow, setIsMessageAutoFollow] = useState(true);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const wsUrl = WS_BASE_URL;
  const pushTimelineEvent = useCallback((kind: string, detail: string) => {
    setTimelineEvents((prev) =>
      [
        { at: new Date().toISOString(), kind, detail },
        ...prev,
      ].slice(0, 40)
    );
  }, []);

  useEffect(() => {
    rpc.connect(wsUrl);

    reconnectTimer.current = window.setInterval(() => {
      if (rpc.readyState === WebSocket.CLOSED) {
        rpc.connect(wsUrl);
      }
      setConnected(rpc.readyState === WebSocket.OPEN);
    }, 1000);

    rpc.on('room/event', (params) => {
      const { item, cursor: nextCursor } = params as { item: ThreadItem; cursor: number };
      setCursor(nextCursor);
      pushTimelineEvent('room/event', item.id);
      setMessages((prev) => {
        const existing = prev.findIndex((m) => m.id === item.id);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = { ...next[existing], ...item };
          return next.sort((a, b) => a.cursor - b.cursor);
        }
        return [...prev, item].sort((a, b) => a.cursor - b.cursor);
      });
    });

    rpc.on('room/owner', (params) => {
      const { ownerClientId: owner, ttlMs: ttl } = params as { ownerClientId: string | null; ttlMs: number };
      setOwnerClientId(owner ?? null);
      setTtlMs(ttl ?? 0);
    });

    rpc.on('agent/message/delta', (params) => {
      const { itemId, delta } = params as { itemId: string; delta: string };
      setStreamingItemId(itemId);
      setStreamingText((prev) => prev + delta);
    });

    rpc.on('turn/finished', (params) => {
      setStreamingText('');
      setStreamingItemId('');
      const payload = asRecord(params);
      const turn = asRecord(payload?.turn);
      const status = typeof turn?.status === 'string' ? turn.status : 'completed';
      setTurnStatus(status);
      const finishedThreadId = typeof payload?.threadId === 'string' ? payload.threadId : undefined;
      if (finishedThreadId) {
        setPendingApprovals((prev) => prev.filter((item) => approvalThreadId(item) !== finishedThreadId));
      }
      const turnError = asRecord(turn?.error);
      if (typeof turnError?.message === 'string') {
        setError(turnError.message);
      }
      pushTimelineEvent('turn/finished', status);
    });

    rpc.on('turn/started', () => {
      setTurnStatus('running');
      pushTimelineEvent('turn/started', 'running');
    });

    rpc.on('error', (params) => {
      const payload = asRecord(params);
      const nestedError = asRecord(payload?.error);
      const message =
        (typeof payload?.message === 'string' && payload.message) ||
        (typeof nestedError?.message === 'string' && nestedError.message) ||
        'Server error';
      setError(message);
      setTurnStatus('error');
      pushTimelineEvent('error', message);
    });

    rpc.on('codex/request', (params) => {
      const request = asRecord(params);
      if (!request || (typeof request.requestId !== 'string' && typeof request.requestId !== 'number')) return;
      const method = String(request.method ?? '');
      const supported = new Set([
        'item/commandExecution/requestApproval',
        'item/fileChange/requestApproval',
        'execCommandApproval',
        'applyPatchApproval',
      ]);
      if (!supported.has(method)) return;
      const nextRequest: ApprovalRequest = {
        requestId: request.requestId,
        method,
        params: request.params ?? {},
      };
      setPendingApprovals((prev) => {
        const key = requestIdKey(nextRequest.requestId);
        const rest = prev.filter((item) => requestIdKey(item.requestId) !== key);
        return [...rest, nextRequest];
      });
      setTurnStatus('waiting_approval');
      pushTimelineEvent('approval', method);
    });

    rpc.on('codex/request/resolved', (params) => {
      const payload = params as { requestId?: string | number; method?: string; status?: string; reason?: string };
      if (!payload || (typeof payload.requestId !== 'string' && typeof payload.requestId !== 'number')) return;
      const key = requestIdKey(payload.requestId);
      setPendingApprovals((prev) => prev.filter((item) => requestIdKey(item.requestId) !== key));
      if (payload.status === 'timeout') {
        const timeoutText = translations[lang].approvalTimeout ?? translations.en.approvalTimeout ?? 'Timed out';
        setError(payload.reason || timeoutText);
        setApprovalHistory((prev) =>
          [
              {
                id: key,
                at: new Date().toISOString(),
                method: String(payload.method ?? ''),
                decision: 'cancel',
                status: 'timeout' as const,
              },
            ...prev,
          ].slice(0, 30)
        );
      }
    });

    return () => {
      if (reconnectTimer.current) window.clearInterval(reconnectTimer.current);
      rpc.close();
    };
  }, [rpc, lang, pushTimelineEvent, wsUrl]);

  useEffect(() => {
    const handler = () => {
      const currentThread = activeThreadRef.current;
      if (!currentThread) return;
      void adapter.unsubscribeRoom(currentThread).catch(() => {
        // best effort on unload
      });
    };
    window.addEventListener('beforeunload', handler);
    window.addEventListener('pagehide', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      window.removeEventListener('pagehide', handler);
    };
  }, [adapter]);

  useEffect(() => {
    activeThreadRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    setIsMessageAutoFollow(true);
    const frame = window.requestAnimationFrame(() => {
      messageListRef.current?.scrollToBottom('auto');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeThreadId]);

  const fetchThreads = useCallback(async (cursor?: string | null, append?: boolean) => {
    try {
      const res = await adapter.listThreads(loadedOnly, cursor);
      setNextCursor(res.nextCursor);
      setThreads((prev) => {
        const next = append ? [...prev, ...res.threads] : res.threads;
        const seen = new Set<string>();
        return next.filter((t) => {
          if (seen.has(t.id)) return false;
          seen.add(t.id);
          return true;
        });
      });
    } catch {
      setThreads([]);
      setNextCursor(null);
    }
  }, [adapter, loadedOnly]);

  const resetComposerState = () => {
    setInput('');
    setStreamingText('');
    setStreamingItemId('');
    setTurnStatus('idle');
  };
  const ensureClientId = useCallback(async (): Promise<string> => {
    if (clientId) return clientId;
    const res = await runtimeSdk.initialize();
    setClientId(res.clientId);
    return res.clientId;
  }, [clientId, runtimeSdk]);

  useEffect(() => {
    if (!connected) return;
    ensureClientId().catch((err) => setError(formatError(err)));
    fetchThreads();
  }, [connected, ensureClientId, fetchThreads]);

  const refreshSkills = useCallback(() => {
    if (!connected) return;
    setSkillsLoading(true);
    setSkillsError('');
    runtimeSdk
      .listSkills()
      .then((res) => setSkills(res.skills ?? []))
      .catch((err) => setSkillsError(formatError(err)))
      .finally(() => setSkillsLoading(false));
  }, [connected, runtimeSdk]);

  const applyWorkspaceSnapshot = useCallback((
    entries: WorkspaceInfo[],
    activePath?: string | null,
    threadProjects?: Record<string, string>,
    recentPaths?: string[],
    favoritePaths?: string[]
  ) => {
    setWorkspaces(entries);
    const activeByEntry = entries.find((entry) => entry.active)?.path ?? '';
    const normalizedActive = activePath ?? activeByEntry;
    setActiveWorkspacePath(normalizedActive || '');
    setLocalProjects(entries.map((entry) => entry.path));
    if (threadProjects) setThreadWorkspaceMap(threadProjects);
    if (recentPaths) setRecentWorkspacePaths(recentPaths);
    if (favoritePaths) setFavoriteWorkspacePaths(favoritePaths);
  }, []);

  const refreshWorkspaces = useCallback(() => {
    if (!connected) return;
    setWorkspaceLoading(true);
    setWorkspaceError('');
    workspaceSdk
      .list()
      .then((res) => applyWorkspaceSnapshot(res.workspaces ?? [], res.activePath, res.threadProjects, res.recentPaths, res.favoritePaths))
      .catch((err) => setWorkspaceError(formatError(err)))
      .finally(() => setWorkspaceLoading(false));
  }, [applyWorkspaceSnapshot, connected, workspaceSdk]);

  const refreshWorktreeItems = useCallback(
    (workspacePath?: string) => {
      const target = workspacePath || activeWorkspacePath;
      if (!connected || !target) {
        setWorktreeItems([]);
        return;
      }
      setWorktreeLoading(true);
      setWorktreeError('');
      workspaceSdk
        .listWorktrees(target)
        .then((res) => setWorktreeItems(res.worktrees ?? []))
        .catch((err) => setWorktreeError(formatError(err)))
        .finally(() => setWorktreeLoading(false));
    },
    [activeWorkspacePath, connected, workspaceSdk]
  );

  useEffect(() => {
    refreshSkills();
  }, [refreshSkills]);

  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  useEffect(() => {
    refreshWorktreeItems(activeWorkspacePath);
  }, [activeWorkspacePath, refreshWorktreeItems]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('animus.settings.v1') ?? localStorage.getItem('codex.settings.v1');
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (parsed.theme === 'light' || parsed.theme === 'dark') setTheme(parsed.theme);
      if (parsed.personality === 'friendly' || parsed.personality === 'pragmatic') setPersonality(parsed.personality);
      if (typeof parsed.customInstructions === 'string') setCustomInstructions(parsed.customInstructions);
      if (typeof parsed.gitBranchPrefix === 'string') setGitBranchPrefix(parsed.gitBranchPrefix);
      if (typeof parsed.gitForcePush === 'boolean') setGitForcePush(parsed.gitForcePush);
      if (typeof parsed.gitCommitInstructions === 'string') setGitCommitInstructions(parsed.gitCommitInstructions);
      if (typeof parsed.gitPrInstructions === 'string') setGitPrInstructions(parsed.gitPrInstructions);
      if (parsed.mcpInstalled && typeof parsed.mcpInstalled === 'object') setMcpInstalled(parsed.mcpInstalled);
      if (Array.isArray(parsed.mcpCustomServers)) setMcpCustomServers(parsed.mcpCustomServers);
      if (Array.isArray(parsed.localProjects)) {
        setLocalProjects(parsed.localProjects);
        setWorkspaces(
          parsed.localProjects.map((path: string) => ({
            id: path,
            path,
            name: path.split('/').filter(Boolean).pop() || path,
            active: path === parsed.activeWorkspacePath,
            exists: true,
          }))
        );
      }
      if (typeof parsed.activeWorkspacePath === 'string') setActiveWorkspacePath(parsed.activeWorkspacePath);
      if (parsed.threadWorkspaceMap && typeof parsed.threadWorkspaceMap === 'object') {
        setThreadWorkspaceMap(parsed.threadWorkspaceMap);
      }
      if (Array.isArray(parsed.recentWorkspacePaths)) setRecentWorkspacePaths(parsed.recentWorkspacePaths);
      if (Array.isArray(parsed.favoriteWorkspacePaths)) setFavoriteWorkspacePaths(parsed.favoriteWorkspacePaths);
      if (typeof parsed.autoSubscribe === 'boolean') setAutoSubscribe(parsed.autoSubscribe);
      if (typeof parsed.autoClaim === 'boolean') setAutoClaim(parsed.autoClaim);
      if (typeof parsed.autoRenew === 'boolean') setAutoRenew(parsed.autoRenew);
      if (typeof parsed.showTimeline === 'boolean') setShowTimeline(parsed.showTimeline);
      if (parsed.codexTransport === 'embedded_ws' || parsed.codexTransport === 'stdio') {
        setCodexTransport(parsed.codexTransport);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const storedLang = localStorage.getItem('animus.lang') ?? localStorage.getItem('codex.lang');
    if (storedLang === 'en' || storedLang === 'zh') {
      setLang(storedLang);
      return;
    }
    const browser = navigator.language.toLowerCase();
    setLang(browser.startsWith('zh') ? 'zh' : 'en');
  }, []);

  useEffect(() => {
    localStorage.setItem('animus.lang', lang);
  }, [lang]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncThreadFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const nextThreadId = params.get(THREAD_QUERY_KEY)?.trim() ?? '';
      setThreadId((prev) => (prev === nextThreadId ? prev : nextThreadId));
    };
    syncThreadFromUrl();
    window.addEventListener('popstate', syncThreadFromUrl);
    return () => window.removeEventListener('popstate', syncThreadFromUrl);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (threadId) {
      url.searchParams.set(THREAD_QUERY_KEY, threadId);
    } else {
      url.searchParams.delete(THREAD_QUERY_KEY);
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
      window.history.replaceState(window.history.state, '', next);
    }
  }, [threadId]);

  const t = useCallback((key: string) => translations[lang][key] ?? translations.en[key] ?? key, [lang]);
  const tWith = useCallback((key: string, vars: Record<string, string>) => {
    const template = t(key);
    return Object.entries(vars).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, value), template);
  }, [t]);
  const { runAction } = useRpcAction({ formatError, setError });

  useEffect(() => {
    const payload = {
      theme,
      personality,
      customInstructions,
      gitBranchPrefix,
      gitForcePush,
      gitCommitInstructions,
      gitPrInstructions,
      mcpInstalled,
      mcpCustomServers,
      localProjects,
      activeWorkspacePath,
      threadWorkspaceMap,
      recentWorkspacePaths,
      favoriteWorkspacePaths,
      autoSubscribe,
      autoClaim,
      autoRenew,
      showTimeline,
      codexTransport,
    };
    localStorage.setItem('animus.settings.v1', JSON.stringify(payload));
  }, [
    theme,
    personality,
    customInstructions,
    gitBranchPrefix,
    gitForcePush,
    gitCommitInstructions,
    gitPrInstructions,
    mcpInstalled,
    mcpCustomServers,
    localProjects,
    activeWorkspacePath,
    threadWorkspaceMap,
    recentWorkspacePaths,
    favoriteWorkspacePaths,
    autoSubscribe,
    autoClaim,
    autoRenew,
    showTimeline,
    codexTransport,
  ]);

  const buildSettingsPayload = useCallback(
    (): SettingsPayload => ({
      version: 1,
      personalization: { personality, instructions: customInstructions },
      automation: { auto_subscribe: autoSubscribe, auto_claim: autoClaim, auto_renew: autoRenew },
      ui: { show_timeline: showTimeline },
      mcp: { installed: mcpInstalled, custom: mcpCustomServers },
      git: {
        branch_prefix: gitBranchPrefix,
        force_push: gitForcePush,
        commit_instructions: gitCommitInstructions,
        pr_instructions: gitPrInstructions,
      },
      runtime: { transport: codexTransport },
      local: {
        projects: localProjects,
        active_project: activeWorkspacePath || null,
        thread_projects: threadWorkspaceMap,
        recent_projects: recentWorkspacePaths,
        favorite_projects: favoriteWorkspacePaths,
      },
    }),
    [
      personality,
      customInstructions,
      autoSubscribe,
      autoClaim,
      autoRenew,
      showTimeline,
      mcpInstalled,
      mcpCustomServers,
      gitBranchPrefix,
      gitForcePush,
      gitCommitInstructions,
      gitPrInstructions,
      codexTransport,
      localProjects,
      activeWorkspacePath,
      threadWorkspaceMap,
      recentWorkspacePaths,
      favoriteWorkspacePaths,
    ]
  );

  const applySettingsPayload = (payload: SettingsPayload) => {
    if (!payload) return;
    if (payload.personalization?.personality === 'friendly' || payload.personalization?.personality === 'pragmatic') {
      setPersonality(payload.personalization.personality as 'friendly' | 'pragmatic');
    }
    if (typeof payload.personalization?.instructions === 'string') setCustomInstructions(payload.personalization.instructions);
    if (typeof payload.automation?.auto_subscribe === 'boolean') setAutoSubscribe(payload.automation.auto_subscribe);
    if (typeof payload.automation?.auto_claim === 'boolean') setAutoClaim(payload.automation.auto_claim);
    if (typeof payload.automation?.auto_renew === 'boolean') setAutoRenew(payload.automation.auto_renew);
    if (typeof payload.ui?.show_timeline === 'boolean') setShowTimeline(payload.ui.show_timeline);
    if (payload.mcp?.installed && typeof payload.mcp.installed === 'object') setMcpInstalled(payload.mcp.installed);
    if (Array.isArray(payload.mcp?.custom)) setMcpCustomServers(payload.mcp.custom);
    if (typeof payload.git?.branch_prefix === 'string') setGitBranchPrefix(payload.git.branch_prefix);
    if (typeof payload.git?.force_push === 'boolean') setGitForcePush(payload.git.force_push);
    if (typeof payload.git?.commit_instructions === 'string') setGitCommitInstructions(payload.git.commit_instructions);
    if (typeof payload.git?.pr_instructions === 'string') setGitPrInstructions(payload.git.pr_instructions);
    if (payload.runtime?.transport === 'embedded_ws' || payload.runtime?.transport === 'stdio') {
      setCodexTransport(payload.runtime.transport);
    }
    if (Array.isArray(payload.local?.projects)) {
      setLocalProjects(payload.local.projects);
      setWorkspaces(
        payload.local.projects.map((path) => ({
          id: path,
          path,
          name: path.split('/').filter(Boolean).pop() || path,
          active: path === payload.local?.active_project,
          exists: true,
        }))
      );
    }
    if (typeof payload.local?.active_project === 'string') setActiveWorkspacePath(payload.local.active_project);
    if (payload.local?.active_project === null) setActiveWorkspacePath('');
    if (payload.local?.thread_projects && typeof payload.local.thread_projects === 'object') {
      setThreadWorkspaceMap(payload.local.thread_projects);
    }
    if (Array.isArray(payload.local?.recent_projects)) setRecentWorkspacePaths(payload.local.recent_projects);
    if (Array.isArray(payload.local?.favorite_projects)) setFavoriteWorkspacePaths(payload.local.favorite_projects);
  };

  useEffect(() => {
    if (!connected || settingsLoaded) return;
    runtimeSdk
      .getSettings<SettingsPayload>()
      .then((res) => {
        if (res) {
          applySettingsPayload(res);
          setSettingsLoaded(true);
        }
      })
      .catch(() => {
        setSettingsLoaded(true);
      });
  }, [connected, runtimeSdk, settingsLoaded]);

  const loadConfig = useCallback(async () => {
    if (!connected) return;
    setConfigLoading(true);
    await runAction(async () => {
      const res = await runtimeSdk.getConfig();
      if (res?.content !== undefined) {
        const draft = localStorage.getItem('animus.config.draft') ?? localStorage.getItem('codex.config.draft');
        const content =
          draft && draft.trim().length > 0
            ? draft
            : res.content.trim().length === 0
              ? DEFAULT_TOML_SAMPLE
              : res.content;
        setConfigText(content);
        setConfigDirty(!!draft);
      }
      if (res?.path) setConfigPath(res.path);
    });
    setConfigLoading(false);
  }, [connected, runAction, runtimeSdk]);

  useEffect(() => {
    if (!connected || activeTab !== 'settings') return;
    if (configLoadedRef.current) return;
    configLoadedRef.current = true;
    loadConfig();
  }, [activeTab, connected, loadConfig]);

  const saveConfig = async () => {
    if (!connected) return;
    try {
      parseToml(configText || '', TOML_PARSE_OPTIONS);
    } catch {
      setError(t('configParseError'));
      return;
    }
    try {
      validateEmbeddedTensorzeroConfig(configText || '');
    } catch {
      setError(t('tensorzeroEmbeddedConfigParseError'));
      return;
    }
    setConfigLoading(true);
    await runAction(async () => {
      await runtimeSdk.setConfig(configText);
      setConfigDirty(false);
      localStorage.removeItem('animus.config.draft');
      localStorage.removeItem('codex.config.draft');
      setSettingsToast(t('configSaved'));
    });
    setConfigLoading(false);
  };

  const formatConfig = () => {
    try {
      const parsed = parseToml(configText || '', TOML_PARSE_OPTIONS);
      const formatted = stringifyToml(parsed as Parameters<typeof stringifyToml>[0], { newline: '\n' });
      setConfigText(formatted);
      setConfigDirty(true);
    } catch (err) {
      setError(`TOML parse error: ${formatError(err)}`);
    }
  };

  useEffect(() => {
    if (!configDirty) return;
    localStorage.setItem('animus.config.draft', configText);
  }, [configDirty, configText]);

  useEffect(() => {
    if (!connected || !settingsLoaded) return;
    if (settingsSaveTimer.current) window.clearTimeout(settingsSaveTimer.current);
    settingsSaveTimer.current = window.setTimeout(() => {
      runtimeSdk.setSettings<SettingsPayload>(buildSettingsPayload()).catch(() => {
        // fallback already stored in localStorage
      });
    }, 300);
  }, [buildSettingsPayload, connected, runtimeSdk, settingsLoaded]);

  useEffect(() => {
    if (!connected || !autoSubscribe || !threadId) return;
    if (activeThreadId === threadId) return;
    handleSubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, autoSubscribe, threadId, activeThreadId]);

  useEffect(() => {
    if (!threadId) return;
    if (activeThreadId && activeThreadId !== threadId) {
      resetComposerState();
    }
  }, [threadId, activeThreadId]);

  useEffect(() => {
    if (!connected || !threadId) return;
    workspaceSdk
      .getThreadWorkspace(threadId)
      .then((res) => {
        if (typeof res.workspacePath === 'string' && res.workspacePath.trim()) {
          setThreadWorkspaceMap((prev) => ({ ...prev, [threadId]: res.workspacePath!.trim() }));
        }
      })
      .catch(() => {
        // non-blocking
      });
  }, [connected, threadId, workspaceSdk]);

  useEffect(() => {
    if (!connected || !autoClaim || !threadId) return;
    handleClaim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, autoClaim, threadId]);

  useEffect(() => {
    if (!connected || !autoRenew || !threadId) return;
    if (!ownerClientId || ownerClientId !== clientId) return;
    const intervalMs = Math.max(5000, Math.min(20000, Math.floor(ttlMs * 0.6)));
    const timer = window.setInterval(() => {
      handleClaim();
    }, intervalMs);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, autoRenew, threadId, ownerClientId, clientId, ttlMs]);

  useEffect(() => {
    if (!isMessageAutoFollow) return;
    messageListRef.current?.scrollToBottom('auto');
  }, [messages.length, streamingText, isMessageAutoFollow]);

  const handleSubscribe = useCallback(async () => {
    setError('');
    if (!threadId) return;
    if (subscribingRef.current === threadId) return;
    subscribingRef.current = threadId;
    await runAction(async () => {
      if (activeThreadId && activeThreadId !== threadId) {
        await adapter.unsubscribeRoom(activeThreadId);
      }
      resetComposerState();
      const res = await adapter.subscribeRoom(threadId, cursor);
      setMessages(res.snapshot);
      setCursor(res.cursor);
      setOwnerClientId(res.ownerClientId);
      setTtlMs(res.ttlMs);
      setActiveThreadId(threadId);
    });
    subscribingRef.current = null;
  }, [activeThreadId, adapter, cursor, runAction, threadId]);

  const createAndSubscribeThread = useCallback(async () => {
    const res = await adapter.startThread();
    const nextThreadId = res.threadId;
    subscribingRef.current = nextThreadId;
    setThreadId(nextThreadId);
    await fetchThreads();
    setCursor(0);
    setMessages([]);
    if (activeThreadId && activeThreadId !== nextThreadId) {
      await adapter.unsubscribeRoom(activeThreadId);
    }
    resetComposerState();
    const snapshot = await adapter.subscribeRoom(nextThreadId);
    setMessages(snapshot.snapshot);
    setCursor(snapshot.cursor);
    setOwnerClientId(snapshot.ownerClientId);
    setTtlMs(snapshot.ttlMs);
    setActiveThreadId(nextThreadId);
    if (!threadWorkspaceMap[nextThreadId] && activeWorkspacePath) {
      if (connected) {
        workspaceSdk
          .setThreadWorkspace(nextThreadId, activeWorkspacePath)
          .then((res) => {
            if (res.threadProjects) setThreadWorkspaceMap(res.threadProjects);
            if (res.recentPaths) setRecentWorkspacePaths(res.recentPaths);
          })
          .catch(() => {
            // non-blocking
          });
      } else {
        setThreadWorkspaceMap((prev) => ({ ...prev, [nextThreadId]: activeWorkspacePath }));
      }
    }
    return nextThreadId;
  }, [activeThreadId, activeWorkspacePath, adapter, connected, fetchThreads, threadWorkspaceMap, workspaceSdk]);

  const handleNewThread = useCallback(async () => {
    setError('');
    await runAction(async () => {
      await createAndSubscribeThread();
    });
    subscribingRef.current = null;
  }, [createAndSubscribeThread, runAction]);

  const handleClaim = useCallback(async () => {
    setError('');
    if (!threadId) return;
    await runAction(async () => {
      await ensureClientId();
      const res = await adapter.claimRoom(threadId);
      setOwnerClientId(res.ownerClientId);
      setTtlMs(res.ttlMs);
    });
  }, [adapter, ensureClientId, runAction, threadId]);

  const handleRelease = useCallback(async () => {
    setError('');
    if (!threadId) return;
    await runAction(async () => {
      const res = await adapter.releaseRoom(threadId);
      setOwnerClientId(res.ownerClientId);
      setTtlMs(0);
    });
  }, [adapter, runAction, threadId]);

  const handleSend = async () => {
    if (!input.trim()) return;
    if (!connected) {
      setError('Disconnected. Reconnecting...');
      rpc.connect(wsUrl);
      return;
    }
    const ensureProviderConfigured = async () => {
      let nextConfigText = configText;
      if (!nextConfigText.trim()) {
        try {
          const res = await runtimeSdk.getConfig();
          nextConfigText = typeof res?.content === 'string' ? res.content : '';
          if (nextConfigText.trim()) setConfigText(nextConfigText);
        } catch {
          // keep fallback to current in-memory config
        }
      }
      if (hasProviderConfig(nextConfigText)) return true;
      setError(t('providerConfigRequiredHint'));
      setModalTitle(t('providerConfigRequiredTitle'));
      setModalBody(t('providerConfigRequiredBody'));
      setModalOpen(true);
      setActiveTab('settings');
      return false;
    };
    if (!(await ensureProviderConfigured())) return;
    setError('');
    try {
      const currentClientId = await ensureClientId();
      setTurnStatus('starting');
      let activeId = threadId;
      const forceClaim = !activeId;
      if (!activeId) {
        activeId = await createAndSubscribeThread();
      }
      if (forceClaim || ownerClientId !== currentClientId) {
        const res = await adapter.claimRoom(activeId);
        setOwnerClientId(res.ownerClientId);
        setTtlMs(res.ttlMs);
        if (res.ownerClientId !== currentClientId) {
          setError(`Not owner (owner: ${String(res.ownerClientId ?? 'none').slice(0, 8)})`);
          setTurnStatus('idle');
          return;
        }
      }
      const effectiveWorkspace = threadWorkspaceMap[activeId] || activeWorkspacePath || undefined;
      if (effectiveWorkspace) {
        if (!threadWorkspaceMap[activeId]) {
          if (connected) {
            try {
              const res = await workspaceSdk.setThreadWorkspace(activeId, effectiveWorkspace);
              if (res.threadProjects) setThreadWorkspaceMap(res.threadProjects);
              if (res.recentPaths) setRecentWorkspacePaths(res.recentPaths);
            } catch {
              // fallback still sends explicit cwd below
            }
          } else {
            setThreadWorkspaceMap((prev) => ({ ...prev, [activeId]: effectiveWorkspace }));
          }
        }
        pushTimelineEvent('workspace', effectiveWorkspace);
      }
      await adapter.startTurn(activeId, input, effectiveWorkspace);
      setInput('');
    } catch (err: unknown) {
      const msg = formatError(err);
      const errData = asRecord(asRecord(err)?.data);
      if (errData?.ownerClientId) {
        setError(`${msg} (owner: ${String(errData.ownerClientId).slice(0, 8)})`);
        return;
      }
      setError(msg);
    } finally {
      subscribingRef.current = null;
    }
  };

  const handleApprovalAction = async (request: ApprovalRequest, action: ApprovalAction) => {
    const result = approvalResult(request, action);
    if (!result) {
      setError(`Unsupported approval request: ${request.method}`);
      return;
    }
    const key = requestIdKey(request.requestId);
    setPendingApprovals((prev) =>
      prev.map((item) => (requestIdKey(item.requestId) === key ? { ...item, submitting: true } : item))
    );
    try {
      await adapter.respondApproval(request.requestId, result);
      setPendingApprovals((prev) => prev.filter((item) => requestIdKey(item.requestId) !== key));
      setApprovalHistory((prev) =>
        [
          {
            id: key,
            at: new Date().toISOString(),
            method: request.method,
            decision: action,
            status: 'answered' as const,
          },
          ...prev,
        ].slice(0, 30)
      );
      setTurnStatus('running');
      pushTimelineEvent('approval', `${request.method}:${action}`);
    } catch (err: unknown) {
      setError(formatError(err));
      setPendingApprovals((prev) =>
        prev.map((item) => (requestIdKey(item.requestId) === key ? { ...item, submitting: false } : item))
      );
    }
  };

  const filteredThreads = threads.filter((t) =>
    `${t.title ?? ''}${t.id}`.toLowerCase().includes(debouncedThreadFilter.toLowerCase())
  );
  const displayThreadTitle = useCallback(
    (thread: Thread) => {
      const title = (thread.title ?? '').trim();
      if (!title || title.toLowerCase() === 'untitled' || /^thread\s+[a-z0-9]{4,}$/i.test(title)) {
        return tWith('threadDetail', { id: thread.id.slice(0, 8) });
      }
      return title;
    },
    [tWith]
  );
  const mobileHeaderTitle = useMemo(() => {
    if (activeTab !== 'chats') return t(activeTab);
    const active = threads.find((item) => item.id === threadId);
    if (!active) return t('chats');
    return displayThreadTitle(active);
  }, [activeTab, displayThreadTitle, t, threadId, threads]);
  const approvalCountByThread = useMemo(() => {
    const counts = new Map<string, number>();
    for (const request of pendingApprovals) {
      const targetThreadId = approvalThreadId(request);
      if (!targetThreadId) continue;
      counts.set(targetThreadId, (counts.get(targetThreadId) ?? 0) + 1);
    }
    return counts;
  }, [pendingApprovals]);
  const activeApprovalCount = useMemo(
    () => (activeThreadId ? approvalCountByThread.get(activeThreadId) ?? 0 : 0),
    [activeThreadId, approvalCountByThread]
  );
  const currentTurnStatus = useMemo(() => turnStatusMeta(turnStatus), [turnStatus]);
  const currentTurnStatusLabel = t(currentTurnStatus.key);
  const timelineDisplayEvents = useMemo(
    () =>
      timelineEvents.map((item) => ({
        ...item,
        kind:
          item.kind === 'room/event'
            ? t('timelineRoomEvent')
            : item.kind === 'turn/started'
              ? t('timelineTurnStarted')
              : item.kind === 'turn/finished'
                ? t('timelineTurnFinished')
                : item.kind === 'approval'
                  ? t('timelineApproval')
                  : item.kind === 'workspace'
                    ? t('timelineWorkspace')
                  : item.kind === 'error'
                    ? t('timelineError')
                    : item.kind,
      })),
    [timelineEvents, t]
  );
  const isOwnedByCurrentClient = !!ownerClientId && ownerClientId === clientId;
  const currentThreadWorkspacePath = useMemo(
    () => (threadId ? threadWorkspaceMap[threadId] || activeWorkspacePath : activeWorkspacePath),
    [activeWorkspacePath, threadId, threadWorkspaceMap]
  );
  const hideSidebar = activeTab !== 'chats' || (!isMobileViewport && desktopSidebarCollapsed);
  const filteredSkills = skills.filter((skill) => {
    const needle = debouncedSkillsFilter.toLowerCase().trim();
    if (!needle) return true;
    return `${skill.name} ${skill.description ?? ''}`.toLowerCase().includes(needle);
  });
  const modelLabel = useMemo(() => {
    if (!configText.trim()) return translations[lang].modelAuto ?? translations.en.modelAuto;
    try {
      const parsed = parseToml(configText, TOML_PARSE_OPTIONS) as Record<string, unknown>;
      const model = parsed?.model ? String(parsed.model) : '';
      const provider = parsed?.model_provider ? String(parsed.model_provider) : '';
      if (model && provider) return `${model} (${provider})`;
      if (model) return model;
    } catch {
      return translations[lang].modelAuto ?? translations.en.modelAuto;
    }
    return translations[lang].modelAuto ?? translations.en.modelAuto;
  }, [configText, lang]);
  const conversationTypeLabel = useMemo(() => {
    const keyByType: Record<ConversationType, string> = {
      codex: 'agentCodex',
      acp: 'agentAcp',
      gemini: 'agentGemini',
      'openclaw-gateway': 'agentOpenClaw',
    };
    return t(keyByType[conversationType]);
  }, [conversationType, t]);
  const adapterProfileLabel = useMemo(
    () => (adapter.profileMode === 'native' ? t('profileNative') : t('profileCompatibility')),
    [adapter.profileMode, t]
  );
  const adapterDiagnostics = adapter.getDiagnostics();
  const adapterMethodRows = useMemo(
    () =>
      [
        { action: 'listThreads', label: t('adapterActionListThreads') },
        { action: 'listLoadedThreads', label: t('adapterActionListLoadedThreads') },
        { action: 'startThread', label: t('adapterActionStartThread') },
        { action: 'subscribeRoom', label: t('adapterActionSubscribeRoom') },
        { action: 'unsubscribeRoom', label: t('adapterActionUnsubscribeRoom') },
        { action: 'claimRoom', label: t('adapterActionClaimRoom') },
        { action: 'releaseRoom', label: t('adapterActionReleaseRoom') },
        { action: 'startTurn', label: t('adapterActionStartTurn') },
        { action: 'respondApproval', label: t('adapterActionRespondApproval') },
      ].map(({ action, label }) => ({
        action: action as AdapterActionKey,
        label,
        method: adapterDiagnostics.resolvedMethods[action as AdapterActionKey],
      })),
    [adapterDiagnostics.resolvedMethods, t]
  );
  const conversationTypeOptions = useMemo(
    () =>
      [
        { value: 'codex' as const, label: t('agentCodex') },
        { value: 'acp' as const, label: t('agentAcp') },
        { value: 'gemini' as const, label: t('agentGemini') },
        { value: 'openclaw-gateway' as const, label: t('agentOpenClaw') },
      ] satisfies Array<{ value: ConversationType; label: string }>,
    [t]
  );

  const mcpRecommended = [
    { id: 'figma', name: 'Figma', description: 'Generate better code by bringing in full Figma context.' },
    { id: 'linear', name: 'Linear', description: "Integrate with Linear's issue tracking and project management." },
    { id: 'notion', name: 'Notion', description: 'Read docs, update pages, manage tasks.' },
    { id: 'github', name: 'GitHub', description: 'Integrate with GitHub APIs to automate workflows and extract data.' },
    { id: 'playwright', name: 'Playwright', description: 'Integrate browser automation to implement design and test UI.' },
  ];
  const installedMcpCount = useMemo(
    () => Object.values(mcpInstalled).filter((installed) => installed).length,
    [mcpInstalled]
  );

  const handleMcpInstall = (id: string) => {
    setMcpInstalled((prev) => ({ ...prev, [id]: true }));
    setSettingsToast(tWith('installedMcp', { id }));
  };

  const handleMcpUninstall = (id: string) => {
    setMcpInstalled((prev) => ({ ...prev, [id]: false }));
    setSettingsToast(tWith('uninstalledMcp', { id }));
  };

  const handleAddCustomMcp = () => {
    setInputModalKind('mcp');
    setInputModalValue('');
  };

  const browseWorkspaceDirectories = useCallback(
    (query?: string | WorkspaceBrowseQuery) => {
      if (!connected) {
        return Promise.reject(new Error('Disconnected'));
      }
      return workspaceSdk.browse(query);
    },
    [connected, workspaceSdk]
  );

  const closeWorkspaceBrowser = useCallback(() => {
    setWorkspaceBrowserOpen(false);
  }, []);

  const handleWorkspaceBrowserAdd = useCallback((path: string) => {
    const normalized = path.trim();
    if (!normalized) return;
    if (!connected) {
      setLocalProjects((prev) => Array.from(new Set([...prev, normalized])));
      setWorkspaces((prev) => {
        if (prev.some((entry) => entry.path === normalized)) return prev;
        const name = normalized.split('/').filter(Boolean).pop() || normalized;
        return [...prev, { id: normalized, path: normalized, name, active: false, exists: true }];
      });
      setSettingsToast(t('projectAdded'));
      setWorkspaceError('');
      return;
    }
    workspaceSdk
      .add(normalized)
      .then((res) => {
        applyWorkspaceSnapshot(res.workspaces ?? [], res.activePath, res.threadProjects, res.recentPaths, res.favoritePaths);
        setWorkspaceError('');
        setSettingsToast(t('projectAdded'));
      })
      .catch((err) => {
        const message = formatError(err);
        setWorkspaceError(message);
      });
  }, [applyWorkspaceSnapshot, connected, t, workspaceSdk]);

  const handleWorkspaceBrowserActivate = useCallback((path: string) => {
    const normalized = path.trim();
    if (!normalized) return;
    if (!connected) {
      setActiveWorkspacePath(normalized);
      setWorkspaces((prev) => prev.map((entry) => ({ ...entry, active: entry.path === normalized })));
      setWorkspaceError('');
      return;
    }
    workspaceSdk
      .activate(normalized)
      .then((res) => {
        applyWorkspaceSnapshot(res.workspaces ?? [], res.activePath, res.threadProjects, res.recentPaths, res.favoritePaths);
        setWorkspaceError('');
      })
      .catch((err) => {
        const message = formatError(err);
        setWorkspaceError(message);
      });
  }, [applyWorkspaceSnapshot, connected, workspaceSdk]);

  const handleWorkspaceSelectForThread = useCallback(
    (path: string, targetThreadId?: string) => {
      const normalized = path.trim();
      const effectiveThreadId = (targetThreadId || threadId || '').trim();
      if (!normalized) return;
      if (!effectiveThreadId) {
        if (!connected) {
          setActiveWorkspacePath(normalized);
          setWorkspaces((prev) => prev.map((entry) => ({ ...entry, active: entry.path === normalized })));
          setWorkspaceError('');
          return;
        }
        workspaceSdk
          .activate(normalized)
          .then((res) => {
            applyWorkspaceSnapshot(res.workspaces ?? [], res.activePath, res.threadProjects, res.recentPaths, res.favoritePaths);
            setWorkspaceError('');
          })
          .catch((err) => setWorkspaceError(formatError(err)));
        return;
      }
      if (!connected) {
        setThreadWorkspaceMap((prev) => ({ ...prev, [effectiveThreadId]: normalized }));
        setRecentWorkspacePaths((prev) => [normalized, ...prev.filter((item) => item !== normalized)].slice(0, 12));
        setWorkspaceError('');
        return;
      }
      workspaceSdk
        .setThreadWorkspace(effectiveThreadId, normalized)
        .then((res) => {
          setThreadWorkspaceMap((prev) => ({ ...prev, ...(res.threadProjects ?? {}) }));
          if (res.recentPaths) setRecentWorkspacePaths(res.recentPaths);
          setWorkspaceError('');
        })
        .catch((err) => {
          setWorkspaceError(formatError(err));
        });
    },
    [applyWorkspaceSnapshot, connected, threadId, workspaceSdk]
  );

  const handleWorkspaceTouchRecent = useCallback(
    (path: string) => {
      const normalized = path.trim();
      if (!normalized) return;
      if (!connected) {
        setRecentWorkspacePaths((prev) => [normalized, ...prev.filter((item) => item !== normalized)].slice(0, 12));
        return;
      }
      workspaceSdk
        .touchRecent(normalized)
        .then((res) => {
          setRecentWorkspacePaths(res.recentPaths ?? []);
          setFavoriteWorkspacePaths(res.favoritePaths ?? []);
        })
        .catch(() => {
          // non-blocking
        });
    },
    [connected, workspaceSdk]
  );

  const handleWorkspaceToggleFavorite = useCallback(
    (path: string) => {
      const normalized = path.trim();
      if (!normalized) return;
      if (!connected) {
        setFavoriteWorkspacePaths((prev) =>
          prev.includes(normalized) ? prev.filter((item) => item !== normalized) : [...prev, normalized]
        );
        return;
      }
      workspaceSdk
        .toggleFavorite(normalized)
        .then((res) => {
          setRecentWorkspacePaths(res.recentPaths ?? []);
          setFavoriteWorkspacePaths(res.favoritePaths ?? []);
        })
        .catch((err) => setWorkspaceError(formatError(err)));
    },
    [connected, workspaceSdk]
  );

  const handleWorkspaceBrowserSelectCurrent = useCallback((path: string) => {
    const normalized = path.trim();
    if (!normalized) return;
    if (!connected) {
      handleWorkspaceBrowserAdd(normalized);
      handleWorkspaceBrowserActivate(normalized);
      handleWorkspaceSelectForThread(normalized);
      closeWorkspaceBrowser();
      return;
    }
    workspaceSdk
      .add(normalized)
      .then((res) => {
        applyWorkspaceSnapshot(res.workspaces ?? [], res.activePath, res.threadProjects, res.recentPaths, res.favoritePaths);
        return workspaceSdk.activate(normalized);
      })
      .then((res) => {
        applyWorkspaceSnapshot(res.workspaces ?? [], res.activePath, res.threadProjects, res.recentPaths, res.favoritePaths);
        handleWorkspaceSelectForThread(normalized);
        setWorkspaceError('');
        setSettingsToast(t('projectAdded'));
        closeWorkspaceBrowser();
      })
      .catch((err) => {
        const message = formatError(err);
        setWorkspaceError(message);
      });
  }, [applyWorkspaceSnapshot, closeWorkspaceBrowser, connected, handleWorkspaceBrowserActivate, handleWorkspaceBrowserAdd, handleWorkspaceSelectForThread, t, workspaceSdk]);

  const handleAddProject = useCallback(() => {
    if (!connected) {
      setInputModalKind('project');
      setInputModalValue('');
      return;
    }
    setWorkspaceBrowserOpen(true);
  }, [connected]);

  const handleCreateWorktree = () => {
    setInputModalKind('worktree');
    setInputModalValue('');
  };

  const closeInputModal = useCallback(() => {
    setInputModalKind(null);
    setInputModalValue('');
  }, []);

  const submitInputModal = useCallback(() => {
    const value = inputModalValue.trim();
    if (!value) return;
    if (inputModalKind === 'mcp') {
      setMcpCustomServers((prev) => Array.from(new Set([...prev, value])));
      setSettingsToast(t('addedCustomMcp'));
      closeInputModal();
      return;
    }
    if (inputModalKind === 'project') {
      if (connected) {
        workspaceSdk
          .add(value)
          .then((res) => {
            applyWorkspaceSnapshot(res.workspaces ?? [], res.activePath, res.threadProjects, res.recentPaths, res.favoritePaths);
            setSettingsToast(t('projectAdded'));
            setWorkspaceError('');
            closeInputModal();
          })
          .catch((err) => setWorkspaceError(formatError(err)));
      } else {
        setLocalProjects((prev) => Array.from(new Set([...prev, value])));
        if (!activeWorkspacePath) setActiveWorkspacePath(value);
        setSettingsToast(t('projectAdded'));
        closeInputModal();
      }
    }
    if (inputModalKind === 'worktree') {
      if (!activeWorkspacePath) {
        setWorktreeError(t('noWorktreeSource'));
        return;
      }
      workspaceSdk
        .createWorktree(activeWorkspacePath, value)
        .then((res) => {
          applyWorkspaceSnapshot(res.workspaces ?? [], res.activePath, res.threadProjects, res.recentPaths, res.favoritePaths);
          setWorktreeItems(res.worktrees ?? []);
          setWorktreeError('');
          setSettingsToast(t('worktreeCreated'));
          closeInputModal();
        })
        .catch((err) => setWorktreeError(formatError(err)));
    }
  }, [
    activeWorkspacePath,
    applyWorkspaceSnapshot,
    closeInputModal,
    connected,
    inputModalKind,
    inputModalValue,
    t,
    workspaceSdk,
  ]);

  const handleWorkspaceActivate = useCallback(
    (path: string) => {
      if (!connected) {
        setActiveWorkspacePath(path);
        setWorkspaces((prev) => prev.map((entry) => ({ ...entry, active: entry.path === path })));
        return;
      }
      workspaceSdk
        .activate(path)
        .then((res) => {
          applyWorkspaceSnapshot(res.workspaces ?? [], res.activePath, res.threadProjects, res.recentPaths, res.favoritePaths);
          setWorkspaceError('');
        })
        .catch((err) => setWorkspaceError(formatError(err)));
    },
    [applyWorkspaceSnapshot, connected, workspaceSdk]
  );

  const handleWorkspaceRemove = useCallback(
    (path: string) => {
      if (!connected) {
        setLocalProjects((prev) => prev.filter((p) => p !== path));
        setWorkspaces((prev) => prev.filter((entry) => entry.path !== path));
        setActiveWorkspacePath((prev) => (prev === path ? '' : prev));
        setThreadWorkspaceMap((prev) =>
          Object.fromEntries(Object.entries(prev).filter(([, workspacePath]) => workspacePath !== path))
        );
        setRecentWorkspacePaths((prev) => prev.filter((item) => item !== path));
        setFavoriteWorkspacePaths((prev) => prev.filter((item) => item !== path));
        return;
      }
      workspaceSdk
        .remove(path)
        .then((res) => {
          applyWorkspaceSnapshot(res.workspaces ?? [], res.activePath, res.threadProjects, res.recentPaths, res.favoritePaths);
          setWorkspaceError('');
        })
        .catch((err) => setWorkspaceError(formatError(err)));
    },
    [applyWorkspaceSnapshot, connected, workspaceSdk]
  );

  const handleWorktreeRemove = useCallback(
    (path: string) => {
      if (!connected || !activeWorkspacePath) return;
      workspaceSdk
        .removeWorktree(activeWorkspacePath, path, true)
        .then((res) => {
          applyWorkspaceSnapshot(res.workspaces ?? [], res.activePath, res.threadProjects, res.recentPaths, res.favoritePaths);
          setWorktreeItems(res.worktrees ?? []);
          setWorktreeError('');
        })
        .catch((err) => setWorktreeError(formatError(err)));
    },
    [activeWorkspacePath, applyWorkspaceSnapshot, connected, workspaceSdk]
  );

  const openModal = (title: string, body: string) => {
    setModalTitle(title);
    setModalBody(body);
    setModalOpen(true);
  };

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'new-thread',
        label: t('cmdNewThread'),
        detail: t('cmdNewThreadDetail'),
        action: () => {
          setPaletteOpen(false);
          handleNewThread();
        },
      },
      {
        id: 'subscribe',
        label: t('cmdSubscribe'),
        detail: threadId ? tWith('threadDetail', { id: threadId.slice(0, 8) }) : t('noThreadSelected'),
        action: () => {
          setPaletteOpen(false);
          handleSubscribe();
        },
      },
      {
        id: 'refresh-threads',
        label: t('cmdRefreshThreads'),
        detail: t('cmdRefreshThreadsDetail'),
        action: () => {
          setPaletteOpen(false);
          fetchThreads();
        },
      },
      {
        id: 'claim',
        label: t('cmdClaim'),
        detail: t('cmdClaimDetail'),
        action: () => {
          setPaletteOpen(false);
          handleClaim();
        },
      },
      {
        id: 'release',
        label: t('cmdRelease'),
        detail: t('cmdReleaseDetail'),
        action: () => {
          setPaletteOpen(false);
          handleRelease();
        },
      },
      {
        id: 'toggle-autosubscribe',
        label: autoSubscribe ? t('cmdAutoSubscribeOff') : t('cmdAutoSubscribeOn'),
        action: () => {
          setPaletteOpen(false);
          setAutoSubscribe((prev) => !prev);
        },
      },
      {
        id: 'toggle-autoclaim',
        label: autoClaim ? t('cmdAutoClaimOff') : t('cmdAutoClaimOn'),
        action: () => {
          setPaletteOpen(false);
          setAutoClaim((prev) => !prev);
        },
      },
      {
        id: 'toggle-autorenew',
        label: autoRenew ? t('cmdAutoRenewOff') : t('cmdAutoRenewOn'),
        action: () => {
          setPaletteOpen(false);
          setAutoRenew((prev) => !prev);
        },
      },
      {
        id: 'toggle-loaded-only',
        label: loadedOnly ? 'Show all threads' : 'Show loaded threads only',
        action: () => {
          setPaletteOpen(false);
          setLoadedOnly((prev) => !prev);
        },
      },
    ],
    [
      autoSubscribe,
      autoClaim,
      autoRenew,
      fetchThreads,
      handleClaim,
      handleNewThread,
      handleRelease,
      handleSubscribe,
      loadedOnly,
      t,
      threadId,
      tWith,
    ]
  );

  const filteredCommands = useMemo(() => {
    const needle = paletteQuery.toLowerCase().trim();
    return commands.filter((command) => {
      if (!needle) return true;
      return `${command.label} ${command.detail ?? ''}`.toLowerCase().includes(needle);
    });
  }, [commands, paletteQuery]);
  const inputModalTitle =
    inputModalKind === 'mcp' ? t('addServer') : inputModalKind === 'worktree' ? t('createWorktree') : t('addProject');
  const inputModalPlaceholder =
    inputModalKind === 'mcp'
      ? t('addMcpPrompt')
      : inputModalKind === 'worktree'
        ? t('addWorktreeBranchPrompt')
        : t('addProjectPrompt');

  useEffect(() => {
    if (paletteOpen) {
      setPaletteQuery('');
      setPaletteIndex(0);
    }
  }, [paletteOpen]);

  useEffect(() => {
    setPaletteIndex(0);
  }, [paletteQuery]);

  useEffect(() => {
    if (paletteIndex >= filteredCommands.length) {
      setPaletteIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, paletteIndex]);

  useEffect(() => {
    const anyOpen =
      paletteOpen || modalOpen || !!inputModalKind || workspaceBrowserOpen || mobileHeaderMenuOpen;
    if (anyOpen && !lastFocusedRef.current) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
      return;
    }
    if (!anyOpen && lastFocusedRef.current) {
      lastFocusedRef.current.focus();
      lastFocusedRef.current = null;
    }
  }, [paletteOpen, modalOpen, inputModalKind, workspaceBrowserOpen, mobileHeaderMenuOpen]);

  useEffect(() => {
    if (
      !paletteOpen &&
      !modalOpen &&
      !inputModalKind &&
      !workspaceBrowserOpen &&
      !mobileSidebarOpen &&
      !mobileHeaderMenuOpen
    )
      return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (mobileSidebarOpen) setMobileSidebarOpen(false);
      if (mobileHeaderMenuOpen) setMobileHeaderMenuOpen(false);
      if (paletteOpen) setPaletteOpen(false);
      if (modalOpen) setModalOpen(false);
      if (inputModalKind) closeInputModal();
      if (workspaceBrowserOpen) closeWorkspaceBrowser();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [
    paletteOpen,
    modalOpen,
    inputModalKind,
    workspaceBrowserOpen,
    mobileSidebarOpen,
    mobileHeaderMenuOpen,
    closeInputModal,
    closeWorkspaceBrowser,
  ]);

  useEffect(() => {
    document.body.classList.toggle('theme-dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    if (desktopShell) {
      document.documentElement.classList.add('animus-desktop');
      setIsMobileViewport(false);
      return;
    }
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 760px)');
    const sync = () => {
      const next = media.matches || isMobileUserAgent();
      setIsMobileViewport(next);
      if (!next) {
        setMobileSidebarOpen(false);
        setMobileHeaderMenuOpen(false);
      }
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [desktopShell]);

  useEffect(() => {
    if (activeTab !== 'chats') setMobileSidebarOpen(false);
    setMobileHeaderMenuOpen(false);
  }, [activeTab]);

  useEffect(() => {
    if (mobileSidebarOpen) setMobileHeaderMenuOpen(false);
  }, [mobileSidebarOpen]);

  useEffect(() => {
    if (!settingsToast) return;
    const timer = window.setTimeout(() => setSettingsToast(''), 2500);
    return () => window.clearTimeout(timer);
  }, [settingsToast]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
      }
      if (event.key === 'Enter' && paletteOpen) {
        const match = filteredCommands[paletteIndex] ?? filteredCommands[0];
        if (match) {
          event.preventDefault();
          match.action();
        }
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [paletteOpen, filteredCommands, paletteIndex]);
  return (
    <div
      className={`app-shell theme-${theme} ${desktopShell ? 'desktop-shell' : ''}`}
      data-animus-window-type={desktopShell ? 'desktop' : 'browser'}
    >
      <header className="app-header">
        <div className="app-brand app-brand-desktop">
          <div className="logo-mark">
            <IconSpark />
          </div>
          <div>
            <div className="app-title">{t('appTitle')}</div>
            <div className="app-subtitle">{t('appSubtitle')} · {conversationTypeLabel}</div>
          </div>
        </div>
        <nav className="app-top-nav app-top-nav-desktop">
          <button
            className={`top-nav-item ${activeTab === 'chats' ? 'active' : ''}`}
            onClick={() => setActiveTab('chats')}
            aria-pressed={activeTab === 'chats'}
          >
            {t('chats')}
          </button>
          <button
            className={`top-nav-item ${activeTab === 'skills' ? 'active' : ''}`}
            onClick={() => setActiveTab('skills')}
            aria-pressed={activeTab === 'skills'}
          >
            {t('skills')}
          </button>
          <button
            className={`top-nav-item ${activeTab === 'apps' ? 'active' : ''}`}
            onClick={() => setActiveTab('apps')}
            aria-pressed={activeTab === 'apps'}
          >
            {t('apps')}
          </button>
          <button
            className={`top-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
            aria-pressed={activeTab === 'settings'}
          >
            {t('settings')}
          </button>
        </nav>
        <div className="app-header-actions app-header-actions-desktop">
          {activeTab === 'chats' && (
            <button
              className="header-icon-button mobile-sidebar-trigger"
              onClick={() => setMobileSidebarOpen((prev) => !prev)}
              aria-expanded={mobileSidebarOpen}
              aria-controls="chat-sidebar"
              title={t('threads')}
              aria-label={t('threads')}
            >
              <span className="icon">
                <IconMenu />
              </span>
            </button>
          )}
          <button className="header-primary-button" onClick={handleNewThread}>
            <span className="icon">
              <IconPlus />
            </span>
            {t('newThread')}
          </button>
          <button
            className="header-icon-button"
            onClick={() => setPaletteOpen(true)}
            title={`${t('command')} (${commandModifierLabel} K)`}
            aria-label={t('command')}
          >
            <span className="icon">
              <IconSearch />
            </span>
          </button>
          <label className="header-lang-select" aria-label={t('language')}>
            <span className="icon">
              <IconGlobe />
            </span>
            <select value={lang} onChange={(e) => setLang(e.target.value as LangKey)}>
              <option value="en">EN</option>
              <option value="zh">中文</option>
            </select>
          </label>
          <label className="header-lang-select header-agent-select" aria-label={t('agentType')}>
            <span className="icon">
              <IconSpark />
            </span>
            <select
              value={conversationType}
              onChange={(e) => onConversationTypeChange?.(e.target.value as ConversationType)}
            >
              {conversationTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div
            className={`connection-indicator ${connected ? 'ok' : 'bad'}`}
            title={connected ? t('connected') : t('disconnected')}
            onClick={() => {
              if (!connected) rpc.connect(wsUrl);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key === ' ') && !connected) {
                event.preventDefault();
                rpc.connect(wsUrl);
              }
            }}
          >
            <span className="connection-dot" />
            <span className="connection-text">{connected ? t('connected') : t('disconnected')}</span>
          </div>
        </div>
        <div className="app-mobile-topbar">
          {activeTab === 'chats' ? (
            <button
              className="header-icon-button mobile-topbar-menu"
              onClick={() => setMobileSidebarOpen((prev) => !prev)}
              aria-expanded={mobileSidebarOpen}
              aria-controls="chat-sidebar"
              title={t('threads')}
              aria-label={t('threads')}
            >
              <span className="icon">
                <IconMenu />
              </span>
            </button>
          ) : (
            <span className="mobile-topbar-menu-placeholder" />
          )}
          <div className="mobile-topbar-title" title={mobileHeaderTitle}>
            {mobileHeaderTitle}
          </div>
          <div className="mobile-topbar-actions">
            <button
              className={`mobile-connection-dot ${connected ? 'ok' : 'bad'}`}
              title={connected ? t('connected') : t('disconnected')}
              aria-label={connected ? t('connected') : t('disconnected')}
              onClick={() => {
                if (!connected) rpc.connect(wsUrl);
              }}
            />
            <button
              className={`mobile-nav-fab ${mobileHeaderMenuOpen ? 'open' : ''}`}
              onClick={() => {
                setMobileSidebarOpen(false);
                setMobileHeaderMenuOpen((prev) => !prev);
              }}
              aria-expanded={mobileHeaderMenuOpen}
              aria-label={t('settings')}
              title={t('settings')}
            >
              <span className="icon">
                <IconMore />
              </span>
            </button>
          </div>
          {mobileHeaderMenuOpen && (
            <>
              <button
                className="mobile-header-menu-backdrop"
                aria-label={t('close')}
                onClick={() => setMobileHeaderMenuOpen(false)}
              />
              <div className="mobile-header-menu">
                <button
                  className={`mobile-menu-item ${activeTab === 'chats' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('chats');
                    setMobileHeaderMenuOpen(false);
                  }}
                >
                  <span className="icon">
                    <IconChat />
                  </span>
                  {t('chats')}
                </button>
                <button
                  className={`mobile-menu-item ${activeTab === 'skills' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('skills');
                    setMobileHeaderMenuOpen(false);
                  }}
                >
                  <span className="icon">
                    <IconSpark />
                  </span>
                  {t('skills')}
                </button>
                <button
                  className={`mobile-menu-item ${activeTab === 'apps' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('apps');
                    setMobileHeaderMenuOpen(false);
                  }}
                >
                  <span className="icon">
                    <IconGrid />
                  </span>
                  {t('apps')}
                </button>
                <button
                  className={`mobile-menu-item ${activeTab === 'settings' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('settings');
                    setMobileHeaderMenuOpen(false);
                  }}
                >
                  <span className="icon">
                    <IconCog />
                  </span>
                  {t('settings')}
                </button>
                <div className="mobile-menu-divider" />
                <button
                  className="mobile-menu-item"
                  onClick={() => {
                    void handleNewThread();
                    setMobileHeaderMenuOpen(false);
                  }}
                >
                  <span className="icon">
                    <IconPlus />
                  </span>
                  {t('newThread')}
                </button>
                <button
                  className="mobile-menu-item"
                  onClick={() => {
                    setPaletteOpen(true);
                    setMobileHeaderMenuOpen(false);
                  }}
                >
                  <span className="icon">
                    <IconSearch />
                  </span>
                  {t('command')}
                </button>
                <label className="mobile-menu-lang" aria-label={t('language')}>
                  <span className="icon">
                    <IconGlobe />
                  </span>
                  <select value={lang} onChange={(e) => setLang(e.target.value as LangKey)}>
                    <option value="en">EN</option>
                    <option value="zh">中文</option>
                  </select>
                </label>
                <label className="mobile-menu-lang" aria-label={t('agentType')}>
                  <span className="icon">
                    <IconSpark />
                  </span>
                  <select
                    value={conversationType}
                    onChange={(e) => onConversationTypeChange?.(e.target.value as ConversationType)}
                  >
                    {conversationTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}
        </div>
      </header>

      <div
        className={`app-body ${hideSidebar ? 'no-sidebar' : ''} ${
          isMobileViewport && mobileSidebarOpen ? 'mobile-sidebar-open' : ''
        }`}
      >

        {activeTab === 'chats' && (isMobileViewport || !desktopSidebarCollapsed) && (
          <>
            <button
              className="mobile-sidebar-backdrop"
              aria-label={t('close')}
              onClick={() => setMobileSidebarOpen(false)}
            />
            <div className="app-sidebar-shell" id="chat-sidebar">
              <ChatsSidebar
                t={t}
                tWith={tWith}
                searchIcon={<IconSearch />}
                plusIcon={<IconPlus />}
                filter={filter}
                setFilter={setFilter}
                fetchThreads={fetchThreads}
                nextCursor={nextCursor}
                filteredThreads={filteredThreads}
                threadId={threadId}
                setThreadId={setThreadId}
                activeThreadId={activeThreadId}
                isOwnedByCurrentClient={isOwnedByCurrentClient}
                currentTurnStatusTone={currentTurnStatus.tone}
                currentTurnStatusLabel={currentTurnStatusLabel}
                approvalCountByThread={approvalCountByThread}
                handleNewThread={handleNewThread}
                handleSubscribe={handleSubscribe}
                ownerClientId={ownerClientId}
                ttlMs={ttlMs}
                handleClaim={handleClaim}
                handleRelease={handleRelease}
                autoSubscribe={autoSubscribe}
                setAutoSubscribe={setAutoSubscribe}
                autoClaim={autoClaim}
                setAutoClaim={setAutoClaim}
                autoRenew={autoRenew}
                setAutoRenew={setAutoRenew}
                loadedOnly={loadedOnly}
                setLoadedOnly={setLoadedOnly}
                onThreadPicked={() => {
                  if (isMobileViewport) setMobileSidebarOpen(false);
                }}
              />
            </div>
          </>
        )}

        <main className={`app-main app-main-${activeTab}`}>
          <div className="main-header">
            <div>
              <div className="main-title-row">
                {activeTab === 'chats' && !isMobileViewport ? (
                  <button
                    type="button"
                    className="header-icon-button main-sidebar-toggle"
                    onClick={() => setDesktopSidebarCollapsed((prev) => !prev)}
                    aria-label={desktopSidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}
                    title={desktopSidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}
                  >
                    <IconMenu />
                  </button>
                ) : null}
                <div className="main-title">
                  {activeTab === 'chats'
                    ? t('room')
                    : activeTab === 'skills'
                      ? t('skills')
                      : activeTab === 'apps'
                        ? t('apps')
                        : t('settings')}
                </div>
              </div>
              <div className="main-subtitle">
                {activeTab === 'chats'
                  ? threadId
                    ? `${threadId.slice(0, 20)} · client ${clientId.slice(0, 8)}`
                    : t('noActiveRoom')
                  : activeTab === 'skills'
                    ? t('manageSkills')
                    : activeTab === 'apps'
                      ? t('manageApps')
                      : t('configureSettings')}
              </div>
            </div>
            <div className="main-meta">
              {activeTab === 'chats' && (
                <span>
                  {t('roomLabel')} {threadId ? threadId.slice(0, 8) : t('none')}
                </span>
              )}
              {activeTab === 'chats' && (
                <span>
                  {t('workspaceDirectory')} {currentThreadWorkspacePath || t('none')}
                </span>
              )}
              {activeTab === 'chats' && (
                <span>
                  {t('model')} {modelLabel}
                </span>
              )}
              <span>
                {t('cursor')} {cursor}
              </span>
              <span>
                {t('turn')}{' '}
                <span className={`status-pill status-pill-${currentTurnStatus.tone}`}>{currentTurnStatusLabel}</span>
              </span>
              <span>
                {t('currentThreadStatus')} {activeThreadId ? t('statusLive') : t('none')}
              </span>
              {activeApprovalCount > 0 && (
                <span>{tWith('statusApprovals', { count: String(activeApprovalCount) })}</span>
              )}
            </div>
          </div>

          {error && (
            <div className="toast-error" role="alert">
              {error}
            </div>
          )}

          {activeTab === 'chats' ? (
            <ChatConversationPanel
              t={t}
              tWith={tWith}
              cursor={cursor}
              currentTurnStatusLabel={currentTurnStatusLabel}
              currentTurnStatusTone={currentTurnStatus.tone}
              activeThreadId={activeThreadId}
              activeApprovalCount={activeApprovalCount}
              timelineEvents={timelineDisplayEvents}
              messages={messages}
              streamingText={streamingText}
              streamingItemId={streamingItemId}
              messageListRef={messageListRef}
              isMessageAutoFollow={isMessageAutoFollow}
              setIsMessageAutoFollow={setIsMessageAutoFollow}
              estimateMessageHeight={estimateMessageHeight}
              displayRole={displayRole}
              shouldShowRaw={shouldShowRaw}
              extractDisplayContent={extractDisplayContent}
              renderMarkdown={renderMarkdown}
              formatTime={formatTime}
              pendingApprovals={pendingApprovals}
              approvalThreadId={approvalThreadId}
              handleApprovalAction={handleApprovalAction}
              approvalHistory={approvalHistory}
              decisionText={decisionText}
              input={input}
              setInput={setInput}
              handleSend={handleSend}
              connected={connected}
              modelLabel={modelLabel}
              ownerClientId={ownerClientId}
              clientId={clientId}
              threadId={threadId}
              showTimeline={showTimeline}
              workspaces={workspaces}
              activeWorkspacePath={currentThreadWorkspacePath}
              workspaceLoading={workspaceLoading}
              workspaceError={workspaceError}
              handleWorkspaceActivate={(path) => handleWorkspaceSelectForThread(path, threadId)}
              handleAddProject={handleAddProject}
              handleNewThread={handleNewThread}
            />
          ) : null}

          {activeTab === 'skills' && (
            <div className="panel-scroll">
              <div className="panel-toolbar">
                <div>
                  <div className="panel-title">{t('skills')}</div>
                  <div className="panel-subtitle">{t('skillsSubtitle')}</div>
                </div>
                <button className="pill" onClick={refreshSkills}>
                  {t('refresh')}
                </button>
              </div>
              <SkillsCatalogContent
                filter={skillsFilter}
                onFilterChange={setSkillsFilter}
                placeholder={t('searchSkills')}
                loading={skillsLoading}
                loadingLabel={t('loadingSkills')}
                error={skillsError}
                skills={filteredSkills}
                emptyTitle={t('noSkills')}
                emptyBody={t('noSkillsBody')}
                noDescriptionLabel={t('noDescription')}
                searchIcon={<IconSearch />}
              />
            </div>
          )}

          {activeTab === 'apps' && (
            <div className="panel-scroll">
              <div className="settings-section">
                <div className="settings-section-header">
                  <div>
                    <div className="settings-section-title">{t('appsRuntimeTitle')}</div>
                    <div className="settings-section-subtitle">{t('appsRuntimeBody')}</div>
                  </div>
                </div>
                <div className="settings-grid">
                  <div className="settings-card">
                    <div className="settings-title">{t('codexTransport')}</div>
                    <div className="settings-row">
                      <span>{t('status')}</span>
                      <span className={`status-chip ${connected ? 'ok' : 'bad'}`}>
                        {connected ? t('connected') : t('disconnected')}
                      </span>
                    </div>
                    <div className="settings-row">
                      <span>{t('codexTransport')}</span>
                      <span className="settings-value">{codexTransport}</span>
                    </div>
                    <div className="settings-row">
                      <span>{t('wsUrl')}</span>
                      <span className="settings-value">{WS_BASE_URL}</span>
                    </div>
                  </div>
                  <div className="settings-card">
                    <div className="settings-title">{t('room')}</div>
                    <div className="settings-row">
                      <span>{t('client')}</span>
                      <span className="settings-value">{clientId || t('none')}</span>
                    </div>
                    <div className="settings-row">
                      <span>{t('roomLabel')}</span>
                      <span className="settings-value">{threadId || t('none')}</span>
                    </div>
                    <div className="settings-actions">
                      <button className="pill" onClick={handleNewThread}>
                        {t('newThread')}
                      </button>
                      <button className="pill pill-ghost" onClick={handleSubscribe} disabled={!threadId}>
                        {t('subscribe')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-section-header">
                  <div>
                    <div className="settings-section-title">{t('appsIntegrationsTitle')}</div>
                    <div className="settings-section-subtitle">{t('appsIntegrationsBody')}</div>
                  </div>
                </div>
                <div className="settings-grid">
                  <div className="settings-card">
                    <div className="settings-title">{t('mcpServers')}</div>
                    <div className="settings-row">
                      <span>{t('install')}</span>
                      <span className="settings-value">{installedMcpCount}</span>
                    </div>
                    <div className="settings-row">
                      <span>{t('customServers')}</span>
                      <span className="settings-value">{mcpCustomServers.length}</span>
                    </div>
                    <div className="settings-actions">
                      <button className="pill" onClick={() => setActiveTab('settings')}>
                        {t('configure')}
                      </button>
                    </div>
                  </div>
                  <div className="settings-card">
                    <div className="settings-title">{t('skills')}</div>
                    <div className="settings-row">
                      <span>{t('status')}</span>
                      <span className="settings-value">{skillsLoading ? t('loadingSkills') : `${filteredSkills.length}`}</span>
                    </div>
                    <div className="settings-actions">
                      <button className="pill" onClick={refreshSkills}>
                        {t('refresh')}
                      </button>
                      <button className="pill pill-ghost" onClick={() => setActiveTab('skills')}>
                        {t('open')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-section-header">
                  <div>
                    <div className="settings-section-title">{t('appsWorkspaceTitle')}</div>
                    <div className="settings-section-subtitle">{t('appsWorkspaceBody')}</div>
                  </div>
                </div>
                <div className="settings-grid">
                  <div className="settings-card">
                    <div className="settings-title">{t('localEnvs')}</div>
                    <div className="settings-row">
                      <span>{t('status')}</span>
                      <span className="settings-value">{workspaces.length}</span>
                    </div>
                    <div className="settings-actions">
                      <button className="pill" onClick={handleAddProject}>
                        {t('addProject')}
                      </button>
                      <button className="pill pill-ghost" onClick={() => setActiveTab('settings')}>
                        {t('configure')}
                      </button>
                    </div>
                  </div>
                  <div className="settings-card">
                    <div className="settings-title">{t('appsActionsTitle')}</div>
                    <div className="settings-body">{t('appsActionsBody')}</div>
                    <div className="settings-actions">
                      <button className="pill" onClick={() => fetchThreads()}>
                        {t('refresh')}
                      </button>
                      <button className="pill pill-ghost" onClick={handleClaim} disabled={!threadId}>
                        {t('claim')}
                      </button>
                      <button className="pill pill-ghost" onClick={handleRelease} disabled={!threadId}>
                        {t('release')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="panel-scroll">
              <div className="panel-toolbar">
                <div>
                  <div className="panel-title">{t('settings')}</div>
                  <div className="panel-subtitle">{t('configureSettings')}</div>
                </div>
              </div>
              {settingsToast && <div className="toast-success">{settingsToast}</div>}

              <div className="settings-section">
                <div className="settings-section-header">
                  <div>
                    <div className="settings-section-title">{t('personalization')}</div>
                    <div className="settings-section-subtitle">{t('toneInstructions')}</div>
                  </div>
                </div>
                <div className="settings-grid">
                  <div className="settings-card">
                    <div className="settings-title">{t('personality')}</div>
                    <div className="settings-row">
                      <span>{t('personality')}</span>
                      <div className="segmented">
                        <button
                          className={`segmented-item ${personality === 'friendly' ? 'active' : ''}`}
                          onClick={() => setPersonality('friendly')}
                        >
                          {t('friendly')}
                        </button>
                        <button
                          className={`segmented-item ${personality === 'pragmatic' ? 'active' : ''}`}
                          onClick={() => setPersonality('pragmatic')}
                        >
                          {t('pragmatic')}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="settings-card">
                    <div className="settings-title">{t('customInstructions')}</div>
                    <textarea
                      className="settings-textarea"
                      rows={6}
                      value={customInstructions}
                      placeholder={t('customInstructions')}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                    />
                    <div className="settings-actions">
                      <button
                        className="pill"
                        onClick={() => setSettingsToast(t('savedCustomInstructions'))}
                      >
                        {t('save')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <SettingsAgentConfigSection
                t={t}
                configDirty={configDirty}
                configPath={configPath}
                configText={configText}
                configLoading={configLoading}
                setConfigText={setConfigText}
                setConfigDirty={setConfigDirty}
                saveConfig={saveConfig}
                loadConfig={loadConfig}
                formatConfig={formatConfig}
                openLicenses={() => openModal(t('licensesModalTitle'), t('licensesModalBody'))}
              />

              <div className="settings-section">
                <div className="settings-section-header">
                  <div>
                    <div className="settings-section-title">{t('skills')}</div>
                    <div className="settings-section-subtitle">{t('skillsSubtitle')}</div>
                  </div>
                  <button className="pill" onClick={refreshSkills}>
                    {t('refresh')}
                  </button>
                </div>
                <SkillsCatalogContent
                  filter={skillsFilter}
                  onFilterChange={setSkillsFilter}
                  placeholder={t('searchSkills')}
                  loading={skillsLoading}
                  loadingLabel={t('loadingSkills')}
                  error={skillsError}
                  skills={filteredSkills}
                  emptyTitle={t('noSkills')}
                  emptyBody={t('noSkillsBody')}
                  noDescriptionLabel={t('noDescription')}
                  searchIcon={<IconSearch />}
                />
              </div>

              <SettingsMcpSection
                t={t}
                tWith={tWith}
                mcpCustomServers={mcpCustomServers}
                mcpRecommended={mcpRecommended}
                mcpInstalled={mcpInstalled}
                onAddCustom={handleAddCustomMcp}
                onRemoveCustom={(name) => {
                  setMcpCustomServers((prev) => prev.filter((item) => item !== name));
                  setSettingsToast(t('removedCustomMcp'));
                }}
                onInstall={handleMcpInstall}
                onUninstall={handleMcpUninstall}
                onOpenModal={openModal}
              />

              <SettingsGitSection
                t={t}
                gitBranchPrefix={gitBranchPrefix}
                setGitBranchPrefix={setGitBranchPrefix}
                gitForcePush={gitForcePush}
                setGitForcePush={setGitForcePush}
                gitCommitInstructions={gitCommitInstructions}
                setGitCommitInstructions={setGitCommitInstructions}
                gitPrInstructions={gitPrInstructions}
                setGitPrInstructions={setGitPrInstructions}
              />

              <div className="settings-section">
                <div className="settings-section-header">
                  <div>
                    <div className="settings-section-title">{t('worktrees')}</div>
                    <div className="settings-section-subtitle">{t('worktreesSubtitle')}</div>
                  </div>
                  <div className="settings-actions">
                    <button className="pill" onClick={handleCreateWorktree} disabled={!activeWorkspacePath}>
                      {t('createWorktree')}
                    </button>
                    <button className="pill pill-ghost" onClick={() => refreshWorktreeItems(activeWorkspacePath)}>
                      {t('refresh')}
                    </button>
                  </div>
                </div>
                <div className="settings-card">
                  {!activeWorkspacePath && <div className="settings-body">{t('noWorktreeSource')}</div>}
                  {activeWorkspacePath && worktreeLoading && <div className="settings-body">{t('loadingWorktrees')}</div>}
                  {activeWorkspacePath && !worktreeLoading && worktreeError && <div className="settings-body">{worktreeError}</div>}
                  {activeWorkspacePath && !worktreeLoading && !worktreeError && worktreeItems.length === 0 && (
                    <div className="settings-body">{t('noWorkspaces')}</div>
                  )}
                  {activeWorkspacePath &&
                    !worktreeLoading &&
                    !worktreeError &&
                    worktreeItems.map((worktree) => (
                      <div key={worktree.path} className="settings-row">
                        <span className="settings-value-code">
                          {worktree.path}
                          {worktree.active ? ` (${t('workspaceActive')})` : ''}
                        </span>
                        <div className="settings-actions">
                          <span className="settings-value">
                            {worktree.branch || (worktree.detached ? t('worktreeDetached') : '-')}
                          </span>
                          {!worktree.active && (
                            <button className="pill pill-ghost" onClick={() => handleWorktreeRemove(worktree.path)}>
                              {t('worktreeRemove')}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-section-header">
                  <div>
                    <div className="settings-section-title">{t('localEnvs')}</div>
                    <div className="settings-section-subtitle">{t('localEnvsSubtitle')}</div>
                  </div>
                  <button className="pill" onClick={handleAddProject}>
                    {t('addProject')}
                  </button>
                </div>
                <div className="settings-grid">
                  {workspaceLoading && (
                    <div className="settings-card">
                      <div className="settings-body">{t('loadingWorkspaces')}</div>
                    </div>
                  )}
                  {!workspaceLoading && workspaceError && (
                    <div className="settings-card">
                      <div className="settings-body">{workspaceError}</div>
                    </div>
                  )}
                  {workspaces.length === 0 && (
                    <div className="settings-card">
                      <div className="settings-body">
                        {t('noProjects')}
                      </div>
                    </div>
                  )}
                  {workspaces.map((workspace) => (
                    <div key={workspace.id} className="settings-card">
                      <div className="settings-title">{workspace.path}</div>
                      <div className="settings-body">
                        {workspace.active ? t('workspaceActive') : t('localEnvNone')}
                        {!workspace.exists ? ` · ${t('workspaceMissing')}` : ''}
                      </div>
                      <div className="settings-actions">
                        {!workspace.active && (
                          <button className="pill" onClick={() => handleWorkspaceActivate(workspace.path)}>
                            {t('workspaceActivate')}
                          </button>
                        )}
                        <button className="pill pill-ghost" onClick={() => handleWorkspaceRemove(workspace.path)}>
                          {t('remove')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <SettingsRuntimeSection
                t={t}
                autoSubscribe={autoSubscribe}
                setAutoSubscribe={setAutoSubscribe}
                autoClaim={autoClaim}
                setAutoClaim={setAutoClaim}
                autoRenew={autoRenew}
                setAutoRenew={setAutoRenew}
                showTimeline={showTimeline}
                setShowTimeline={setShowTimeline}
                loadedOnly={loadedOnly}
                setLoadedOnly={setLoadedOnly}
                theme={theme}
                setTheme={setTheme}
                codexTransport={codexTransport}
                setCodexTransport={setCodexTransport}
                connected={connected}
                clientId={clientId}
                threadId={threadId}
                wsUrl={WS_BASE_URL}
                conversationTypeLabel={conversationTypeLabel}
                conversationType={conversationType}
                conversationTypeOptions={conversationTypeOptions}
                onConversationTypeChange={onConversationTypeChange}
                adapterProfileLabel={adapterProfileLabel}
                adapterProfileMode={adapter.profileMode}
                adapterResolvedMethods={adapterMethodRows}
              />
            </div>
          )}
        </main>
      </div>

      <InfoModal
        open={modalOpen}
        title={modalTitle}
        body={modalBody}
        closeLabel={t('close')}
        onClose={() => setModalOpen(false)}
      />

      <DirectoryBrowserModal
        open={workspaceBrowserOpen}
        title={t('workspaceChoose')}
        startPath={currentThreadWorkspacePath || undefined}
        closeLabel={t('close')}
        refreshLabel={t('refresh')}
        upLabel={t('workspaceBrowseUp')}
        openAsRootLabel={t('workspaceBrowseOpenAsRoot')}
        goLabel={t('go')}
        pathPlaceholder={t('workspaceBrowsePathPlaceholder')}
        searchPlaceholder={t('workspaceBrowseSearchPlaceholder')}
        recentLabel={t('workspaceBrowseRecent')}
        favoritesLabel={t('workspaceBrowseFavorites')}
        loadMoreLabel={t('loadMore')}
        favoriteLabel={t('workspaceBrowseFavorite')}
        unfavoriteLabel={t('workspaceBrowseUnfavorite')}
        selectCurrentLabel={t('workspaceBrowseSelectCurrent')}
        addLabel={t('workspaceBrowseAdd')}
        activateLabel={t('workspaceActivate')}
        addAndActivateLabel={t('workspaceBrowseAddAndActivate')}
        statusAddedLabel={t('workspaceBrowseStatusAdded')}
        statusActiveLabel={t('workspaceActive')}
        emptyLabel={t('workspaceBrowseEmpty')}
        recentPaths={recentWorkspacePaths}
        favoritePaths={favoriteWorkspacePaths}
        fetchDirectories={browseWorkspaceDirectories}
        onAddPath={handleWorkspaceBrowserAdd}
        onActivatePath={handleWorkspaceBrowserActivate}
        onToggleFavorite={handleWorkspaceToggleFavorite}
        onTouchRecent={handleWorkspaceTouchRecent}
        onSelectCurrent={handleWorkspaceBrowserSelectCurrent}
        isWorkspaceAdded={(path) => workspaces.some((workspace) => workspace.path === path)}
        isWorkspaceActive={(path) => currentThreadWorkspacePath === path}
        isWorkspaceFavorite={(path) => favoriteWorkspacePaths.includes(path)}
        onClose={closeWorkspaceBrowser}
      />

      <InputModal
        open={!!inputModalKind}
        title={inputModalTitle}
        value={inputModalValue}
        placeholder={inputModalPlaceholder}
        closeLabel={t('close')}
        saveLabel={t('save')}
        onChange={setInputModalValue}
        onClose={closeInputModal}
        onSubmit={submitInputModal}
      />

      <CommandPalette
        open={paletteOpen}
        title={t('command')}
        query={paletteQuery}
        placeholder={t('commandPlaceholder')}
        emptyLabel={t('noCommandsFound')}
        searchIcon={<IconSearch />}
        commands={filteredCommands}
        selectedIndex={paletteIndex}
        onSelectedIndexChange={setPaletteIndex}
        onSubmitCurrent={() => {
          const match = filteredCommands[paletteIndex] ?? filteredCommands[0];
          if (match) match.action();
        }}
        onQueryChange={setPaletteQuery}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
