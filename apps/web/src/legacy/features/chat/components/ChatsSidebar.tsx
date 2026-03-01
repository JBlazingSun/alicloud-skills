import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Thread } from '../../../types';

type ChatsSidebarProps = {
  t: (key: string) => string;
  tWith: (key: string, vars: Record<string, string>) => string;
  searchIcon: ReactNode;
  plusIcon: ReactNode;
  filter: string;
  setFilter: Dispatch<SetStateAction<string>>;
  fetchThreads: (cursor?: string | null, append?: boolean) => Promise<void>;
  nextCursor: string | null;
  filteredThreads: Thread[];
  threadId: string;
  setThreadId: Dispatch<SetStateAction<string>>;
  activeThreadId: string;
  isOwnedByCurrentClient: boolean;
  currentTurnStatusTone: 'idle' | 'running' | 'waiting' | 'error';
  currentTurnStatusLabel: string;
  approvalCountByThread: Map<string, number>;
  handleNewThread: () => Promise<void>;
  handleSubscribe: () => Promise<void>;
  ownerClientId: string | null;
  ttlMs: number;
  handleClaim: () => Promise<void>;
  handleRelease: () => Promise<void>;
  autoSubscribe: boolean;
  setAutoSubscribe: Dispatch<SetStateAction<boolean>>;
  autoClaim: boolean;
  setAutoClaim: Dispatch<SetStateAction<boolean>>;
  autoRenew: boolean;
  setAutoRenew: Dispatch<SetStateAction<boolean>>;
  loadedOnly: boolean;
  setLoadedOnly: Dispatch<SetStateAction<boolean>>;
  onThreadPicked?: () => void;
};

export function ChatsSidebar({
  t,
  tWith,
  searchIcon,
  plusIcon,
  filter,
  setFilter,
  fetchThreads,
  nextCursor,
  filteredThreads,
  threadId,
  setThreadId,
  activeThreadId,
  isOwnedByCurrentClient,
  currentTurnStatusTone,
  currentTurnStatusLabel,
  approvalCountByThread,
  handleNewThread,
  handleSubscribe,
  ownerClientId,
  ttlMs,
  handleClaim,
  handleRelease,
  autoSubscribe,
  setAutoSubscribe,
  autoClaim,
  setAutoClaim,
  autoRenew,
  setAutoRenew,
  loadedOnly,
  setLoadedOnly,
  onThreadPicked,
}: ChatsSidebarProps) {
  const [roomExpanded, setRoomExpanded] = useState(false);
  const [automationExpanded, setAutomationExpanded] = useState(false);

  const parseThreadCreatedAt = (raw: unknown) => {
    if (raw === null || raw === undefined) return null;
    if (raw instanceof Date) {
      return Number.isNaN(raw.getTime()) ? null : raw;
    }
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) return null;
      const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof raw !== 'string') return null;
    const text = raw.trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) {
      const n = Number(text);
      if (!Number.isFinite(n)) return null;
      const ms = n < 1_000_000_000_000 ? n * 1000 : n;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatLocalTime = (date: Date) =>
    new Intl.DateTimeFormat(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);

  const formatThreadMeta = (thread: Thread) => {
    const created = parseThreadCreatedAt(thread.createdAt);
    const timeLabel = created ? formatLocalTime(created) : '';
    const shortId = thread.id.slice(0, 8);
    return timeLabel ? `${timeLabel} · ${shortId}` : shortId;
  };

  const displayThreadTitle = (thread: Thread) => {
    const title = (thread.title ?? '').trim();
    if (!title || title.toLowerCase() === 'untitled' || /^thread\s+[a-z0-9]{4,}$/i.test(title)) {
      return tWith('threadDetail', { id: thread.id.slice(0, 8) });
    }
    return title;
  };

  const threadEmptyText = (() => {
    if (filter.trim().length > 0) return t('threadsEmptyFiltered');
    if (loadedOnly) return t('threadsEmptyLoadedOnly');
    return t('threadsEmpty');
  })();

  return (
    <aside className="app-sidebar">
      <div className="sidebar-section sidebar-section-threads">
        <div className="section-header">
          <span>{t('threads')}</span>
          <button className="icon-button" onClick={() => void handleNewThread()}>
            {plusIcon}
          </button>
        </div>
        <div className="search-input">
          {searchIcon}
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('searchThreads')} />
        </div>
        <div className="button-row">
          <button className="pill" onClick={() => void fetchThreads()}>
            {t('refresh')}
          </button>
          <button className="pill" onClick={() => void fetchThreads(nextCursor, true)} disabled={!nextCursor}>
            {t('loadMore')}
          </button>
        </div>
        <div className="thread-list thread-list-simple">
          {filteredThreads.map((thread) => {
            const isSelected = threadId === thread.id;
            const isLive = activeThreadId === thread.id;
            const isOwned = isLive && isOwnedByCurrentClient;
            const approvalCount = approvalCountByThread.get(thread.id) ?? 0;
            return (
              <button
                key={thread.id}
                className={`thread-row ${isSelected ? 'active' : ''}`}
                onClick={() => {
                  setThreadId(thread.id);
                  onThreadPicked?.();
                }}
                aria-pressed={isSelected}
              >
                <div className="thread-title">{displayThreadTitle(thread)}</div>
                <div className="thread-meta">{formatThreadMeta(thread)}</div>
                <div className="thread-status-row">
                  {isLive && <span className="mini-badge">{t('statusLive')}</span>}
                  {!isLive && isSelected && <span className="mini-badge">{t('statusSelected')}</span>}
                  {isOwned && <span className="mini-badge mini-badge-accent">{t('statusOwned')}</span>}
                  {isLive && (
                    <span className={`mini-badge mini-badge-turn mini-badge-turn-${currentTurnStatusTone}`}>
                      {currentTurnStatusLabel}
                    </span>
                  )}
                  {approvalCount > 0 && (
                    <span className="mini-badge mini-badge-warn">
                      {tWith('statusApprovals', { count: String(approvalCount) })}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {filteredThreads.length === 0 && <div className="muted">{threadEmptyText}</div>}
        </div>
      </div>

      <div className="sidebar-section sidebar-section-room">
        <div className="section-header section-header-toggle">
          <span>{t('room')}</span>
          <button
            className="icon-button section-toggle-button"
            onClick={() => setRoomExpanded((prev) => !prev)}
            aria-expanded={roomExpanded}
            aria-label={t('room')}
          >
            {roomExpanded ? '−' : '+'}
          </button>
        </div>
        <div className={`sidebar-collapsible-body ${roomExpanded ? 'expanded' : ''}`}>
          <label className="input-label">{t('threadId')}</label>
          <div className="row-input">
            <input value={threadId} onChange={(e) => setThreadId(e.target.value)} placeholder={t('threadId')} />
            <button className="pill" onClick={() => void handleSubscribe()} disabled={!threadId}>
              {t('subscribe')}
            </button>
          </div>
          <div className="room-meta">
            <div>
              <span className="muted">{t('owner')}</span>
              <div className="owner-tag">
                {ownerClientId ? ownerClientId.slice(0, 8) : t('none')}
                {ttlMs > 0 ? ` · TTL ${(ttlMs / 1000).toFixed(0)}s` : ''}
              </div>
            </div>
            <div className="button-row">
              <button className="pill" onClick={() => void handleClaim()} disabled={!threadId}>
                {t('claim')}
              </button>
              <button className="pill" onClick={() => void handleRelease()} disabled={!threadId}>
                {t('release')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="sidebar-section sidebar-section-automation">
        <div className="section-header section-header-toggle">
          <span>{t('automation')}</span>
          <button
            className="icon-button section-toggle-button"
            onClick={() => setAutomationExpanded((prev) => !prev)}
            aria-expanded={automationExpanded}
            aria-label={t('automation')}
          >
            {automationExpanded ? '−' : '+'}
          </button>
        </div>
        <div className={`sidebar-collapsible-body ${automationExpanded ? 'expanded' : ''}`}>
          <label className="toggle">
            <input type="checkbox" checked={autoSubscribe} onChange={(e) => setAutoSubscribe(e.target.checked)} />
            {t('autoSubscribe')}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={autoClaim} onChange={(e) => setAutoClaim(e.target.checked)} />
            {t('autoClaim')}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
            {t('autoRenew')}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={loadedOnly} onChange={(e) => setLoadedOnly(e.target.checked)} />
            {t('loadedOnly')}
          </label>
        </div>
      </div>
    </aside>
  );
}
