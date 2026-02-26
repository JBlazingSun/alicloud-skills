import { useState, type Dispatch, type SetStateAction } from 'react';
import type { ThreadItem } from '../../../types';
import { VariableVirtualList, type VariableVirtualListHandle } from '../../shared/VariableVirtualList';

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

type StatusTone = 'idle' | 'running' | 'waiting' | 'error';

type ChatConversationPanelProps = {
  t: (key: string) => string;
  tWith: (key: string, vars: Record<string, string>) => string;
  cursor: number;
  currentTurnStatusLabel: string;
  currentTurnStatusTone: StatusTone;
  activeThreadId: string;
  activeApprovalCount: number;
  timelineEvents: Array<{ at: string; kind: string; detail: string }>;
  messages: ThreadItem[];
  streamingText: string;
  streamingItemId: string;
  messageListRef: React.RefObject<VariableVirtualListHandle | null>;
  isMessageAutoFollow: boolean;
  setIsMessageAutoFollow: Dispatch<SetStateAction<boolean>>;
  estimateMessageHeight: (item: ThreadItem) => number;
  displayRole: (item: ThreadItem, t: (key: string) => string) => { label: string; variant: string };
  shouldShowRaw: (item: ThreadItem) => boolean;
  extractDisplayContent: (item: ThreadItem) => string;
  renderMarkdown: (text: string) => string;
  formatTime: (iso?: string) => string;
  pendingApprovals: ApprovalRequest[];
  approvalThreadId: (request: ApprovalRequest) => string | undefined;
  handleApprovalAction: (request: ApprovalRequest, action: ApprovalAction) => Promise<void>;
  approvalHistory: ApprovalHistoryItem[];
  decisionText: (decision: string, t: (key: string) => string) => string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  handleSend: () => Promise<void>;
  connected: boolean;
  modelLabel: string;
  ownerClientId: string | null;
  clientId: string;
  threadId: string;
  showTimeline: boolean;
  workspaces: Array<{
    id: string;
    path: string;
    name: string;
    active: boolean;
    exists: boolean;
  }>;
  activeWorkspacePath: string;
  workspaceLoading: boolean;
  workspaceError: string;
  handleWorkspaceActivate: (path: string) => void;
  handleAddProject: () => void;
  handleNewThread: () => Promise<void>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return value as Record<string, unknown>;
}

function requestIdKey(id: string | number) {
  return typeof id === 'number' ? `n:${id}` : `s:${id}`;
}

export function ChatConversationPanel({
  t,
  tWith,
  cursor,
  currentTurnStatusLabel,
  currentTurnStatusTone,
  activeThreadId,
  activeApprovalCount,
  timelineEvents,
  messages,
  streamingText,
  streamingItemId,
  messageListRef,
  isMessageAutoFollow,
  setIsMessageAutoFollow,
  estimateMessageHeight,
  displayRole,
  shouldShowRaw,
  extractDisplayContent,
  renderMarkdown,
  formatTime,
  pendingApprovals,
  approvalThreadId,
  handleApprovalAction,
  approvalHistory,
  decisionText,
  input,
  setInput,
  handleSend,
  connected,
  modelLabel,
  ownerClientId,
  clientId,
  threadId,
  showTimeline,
  workspaces,
  activeWorkspacePath,
  workspaceLoading,
  workspaceError,
  handleWorkspaceActivate,
  handleAddProject,
  handleNewThread,
}: ChatConversationPanelProps) {
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const starterPrompts = [
    t('starterPromptProjectSummary'),
    t('starterPromptTaskPlan'),
    t('starterPromptBugFixes'),
  ];
  return (
    <>
      <div className="message-stream">
        {messages.length === 0 && !streamingText && (
          <div className="empty-state">
            <div className="empty-title">{t('startConversation')}</div>
            <div className="empty-body">{t('startConversationBody')}</div>
            <div className="empty-action-grid">
              <button
                type="button"
                className="empty-action-card"
                onClick={() => {
                  void handleNewThread();
                }}
              >
                <div className="empty-action-title">{t('newThread')}</div>
                <div className="empty-action-body">{t('cmdNewThreadDetail')}</div>
              </button>
              <button type="button" className="empty-action-card" onClick={handleAddProject}>
                <div className="empty-action-title">{t('workspaceChoose')}</div>
                <div className="empty-action-body">{t('workspaceDirectory')}</div>
              </button>
              <div className="empty-action-card">
                <div className="empty-action-title">{t('command')}</div>
                <div className="empty-action-body">{t('commandPlaceholder')}</div>
                <div className="empty-prompt-list">
                  {starterPrompts.map((prompt) => (
                    <button
                      type="button"
                      key={prompt}
                      className="empty-prompt-chip"
                      onClick={() => setInput(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        <VariableVirtualList
          ref={messageListRef}
          className="message-virtual-list"
          items={messages}
          estimateHeight={estimateMessageHeight}
          overscan={4}
          followTail
          onFollowTailChange={setIsMessageAutoFollow}
          renderItem={(m) => {
            const role = displayRole(m, t);
            const rawText = shouldShowRaw(m) ? JSON.stringify(m.raw ?? {}, null, 2) : '';
            const content = extractDisplayContent(m);
            const contentHtml = renderMarkdown(content);
            return (
              <div key={m.id} className={`message-row ${role.variant}`}>
                <div className="message-card">
                  <div className="message-meta">
                    <span className="badge">{role.label}</span>
                    <span>{formatTime(m.createdAt)}</span>
                  </div>
                  <div className="message-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />
                  {rawText && (
                    <details className="message-raw-toggle">
                      <summary>{t('raw')}</summary>
                      <pre className="message-raw">
                        <code className="language-json">{rawText}</code>
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            );
          }}
        />
        {streamingText && (
          <div className="message-row assistant" key={streamingItemId}>
            <div className="message-card streaming">
              <div className="message-meta">
                <span className="badge">{t('assistant')}</span>
                <span>{t('streaming')}</span>
              </div>
              <div className="message-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingText) }} />
            </div>
          </div>
        )}
      </div>

      {pendingApprovals.length > 0 && (
        <div className="approval-stack">
          {pendingApprovals
            .filter((request) => {
              const reqThreadId = approvalThreadId(request);
              return !reqThreadId || !activeThreadId || reqThreadId === activeThreadId;
            })
            .map((request) => {
              const params = asRecord(request.params) ?? {};
              const isCommandApproval =
                request.method === 'item/commandExecution/requestApproval' || request.method === 'execCommandApproval';
              const title = isCommandApproval ? t('approvalCommand') : t('approvalFile');
              const command = params.command;
              const commandValue = Array.isArray(command)
                ? command.map((part) => String(part)).join(' ')
                : typeof command === 'string'
                  ? command
                  : '';
              return (
                <div key={requestIdKey(request.requestId)} className="approval-card">
                  <div className="approval-head">
                    <div className="approval-title">{t('approvalRequired')}</div>
                    <div className="approval-type">{title}</div>
                  </div>
                  <div className="approval-meta">
                    <span className="muted">
                      {t('approvalMethod')}: <code>{request.method}</code>
                    </span>
                    {typeof params.reason === 'string' && params.reason.length > 0 && (
                      <span className="muted">
                        {t('approvalReason')}: {String(params.reason)}
                      </span>
                    )}
                    {typeof params.cwd === 'string' && params.cwd.length > 0 && (
                      <span className="muted">
                        {t('approvalCwd')}: <code>{String(params.cwd)}</code>
                      </span>
                    )}
                    {commandValue && (
                      <pre className="approval-command">
                        <code>{commandValue}</code>
                      </pre>
                    )}
                  </div>
                  <div className="approval-actions">
                    <button className="pill" onClick={() => void handleApprovalAction(request, 'accept')} disabled={!!request.submitting}>
                      {request.submitting ? t('approvalSubmitting') : t('approveOnce')}
                    </button>
                    <button className="pill" onClick={() => void handleApprovalAction(request, 'acceptForSession')} disabled={!!request.submitting}>
                      {t('approveSession')}
                    </button>
                    <button className="pill pill-ghost" onClick={() => void handleApprovalAction(request, 'decline')} disabled={!!request.submitting}>
                      {t('decline')}
                    </button>
                    <button className="pill pill-ghost" onClick={() => void handleApprovalAction(request, 'cancel')} disabled={!!request.submitting}>
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {approvalHistory.length > 0 && (
        <div className="approval-history">
          <div className="approval-history-title">{t('approvalHistory')}</div>
          {approvalHistory.slice(0, 8).map((item) => (
            <div key={`${item.id}-${item.at}`} className="approval-history-item">
              <span className="muted">{formatTime(item.at)}</span>
              <code>{item.method}</code>
              <span>{decisionText(item.decision, t)}</span>
              <span className="muted">{item.status === 'timeout' ? t('approvalTimeout') : t('approvalAnswered')}</span>
            </div>
          ))}
        </div>
      )}

      {showTimeline && (
        <div className="event-timeline">
          <div className="event-timeline-head">
            <span>{t('cursor')} {cursor}</span>
            <span className={`status-pill status-pill-${currentTurnStatusTone}`}>{currentTurnStatusLabel}</span>
            {activeApprovalCount > 0 && <span>{tWith('statusApprovals', { count: String(activeApprovalCount) })}</span>}
          </div>
          <div className="event-timeline-title-row">
            <button
              type="button"
              className="event-timeline-toggle"
              onClick={() => setTimelineExpanded((prev) => !prev)}
              aria-expanded={timelineExpanded}
            >
              {t('timeline')} {timelineExpanded ? '▲' : '▼'}
            </button>
            {timelineEvents.length > 0 && <span className="muted">{timelineEvents.length}</span>}
          </div>
          {timelineExpanded && (
            <div className="event-timeline-events">
              {timelineEvents.length === 0 && <div className="muted">{t('timelineEmpty')}</div>}
              {timelineEvents.map((item) => (
                <div key={`${item.at}-${item.kind}-${item.detail}`} className="event-item">
                  <span className="muted">{formatTime(item.at)}</span>
                  <span className="event-kind">{item.kind}</span>
                  <span className="event-detail">{item.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="composer">
        <div className="composer-toolbar">
          <div className="toolbar-group">
            <span className="toolbar-label">{t('model')}</span>
            <span className="toolbar-pill">{modelLabel}</span>
          </div>
          <div className="toolbar-group">
            <span className="toolbar-label">{t('owner')}</span>
            <span className={`toolbar-pill ${ownerClientId === clientId ? 'accent' : ''}`}>
              {ownerClientId ? ownerClientId.slice(0, 8) : t('none')}
            </span>
          </div>
          <div className="toolbar-group">
            <span className="toolbar-label">{t('status')}</span>
            <span className={`toolbar-pill toolbar-pill-${currentTurnStatusTone}`}>{currentTurnStatusLabel}</span>
          </div>
          <div className="toolbar-group">
            <span className="toolbar-label">{t('statusAutoFollow')}</span>
            <span className="toolbar-pill">{isMessageAutoFollow ? t('statusFollowing') : t('statusPausedFollow')}</span>
            {!isMessageAutoFollow && (
              <button
                className="pill pill-ghost"
                onClick={() => {
                  setIsMessageAutoFollow(true);
                  messageListRef.current?.scrollToBottom('smooth');
                }}
              >
                {t('scrollToLatest')}
              </button>
            )}
            <div className="toolbar-workspace-inline">
              <span className="toolbar-label">{t('workspaceDirectory')}</span>
              <select
                className="workspace-select"
                value={activeWorkspacePath}
                onChange={(event) => handleWorkspaceActivate(event.target.value)}
                disabled={workspaceLoading || workspaces.length === 0}
              >
                {workspaces.length === 0 ? (
                  <option value="">{t('noWorkspaces')}</option>
                ) : null}
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.path}>
                    {workspace.name}
                    {workspace.active ? ` (${t('workspaceActive')})` : ''}
                    {!workspace.exists ? ` (${t('workspaceMissing')})` : ''}
                  </option>
                ))}
              </select>
              <button className="pill pill-ghost" type="button" onClick={handleAddProject}>
                {t('workspaceChoose')}
              </button>
            </div>
          </div>
        </div>
        <div className="composer-input">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('composerPlaceholder')}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <div className="composer-actions">
            <button className="pill send-button" onClick={() => void handleSend()} disabled={!connected || !input.trim()}>
              {t('send')}
            </button>
          </div>
        </div>
        {workspaceError && <span className="workspace-inline-error">{workspaceError}</span>}
        <div className="composer-footer">
          <span className="muted">
            {t('client')} {clientId ? clientId.slice(0, 8) : '...'}
          </span>
          <span className="muted">
            {t('roomLabel')} {threadId ? threadId.slice(0, 8) : t('none')}
          </span>
        </div>
      </div>
    </>
  );
}
