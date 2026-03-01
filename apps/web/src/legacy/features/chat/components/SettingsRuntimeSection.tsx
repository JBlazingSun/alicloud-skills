import type { AdapterActionKey } from '../../conversation/adapter';

type SettingsRuntimeSectionProps = {
  t: (key: string) => string;
  autoSubscribe: boolean;
  setAutoSubscribe: (value: boolean) => void;
  autoClaim: boolean;
  setAutoClaim: (value: boolean) => void;
  autoRenew: boolean;
  setAutoRenew: (value: boolean) => void;
  loadedOnly: boolean;
  setLoadedOnly: (value: boolean) => void;
  showTimeline: boolean;
  setShowTimeline: (value: boolean) => void;
  theme: 'light' | 'dark';
  setTheme: (value: 'light' | 'dark') => void;
  codexTransport: 'embedded_ws' | 'stdio';
  setCodexTransport: (value: 'embedded_ws' | 'stdio') => void;
  connected: boolean;
  clientId: string;
  threadId: string;
  wsUrl: string;
  conversationTypeLabel: string;
  conversationType: 'codex' | 'acp' | 'gemini' | 'openclaw-gateway';
  conversationTypeOptions: Array<{ value: 'codex' | 'acp' | 'gemini' | 'openclaw-gateway'; label: string }>;
  onConversationTypeChange?: (nextType: 'codex' | 'acp' | 'gemini' | 'openclaw-gateway') => void;
  adapterProfileLabel: string;
  adapterProfileMode: 'native' | 'compatibility';
  adapterResolvedMethods: Array<{ action: AdapterActionKey; label: string; method: string | null }>;
};

export function SettingsRuntimeSection({
  t,
  autoSubscribe,
  setAutoSubscribe,
  autoClaim,
  setAutoClaim,
  autoRenew,
  setAutoRenew,
  loadedOnly,
  setLoadedOnly,
  showTimeline,
  setShowTimeline,
  theme,
  setTheme,
  codexTransport,
  setCodexTransport,
  connected,
  clientId,
  threadId,
  wsUrl,
  conversationTypeLabel,
  conversationType,
  conversationTypeOptions,
  onConversationTypeChange,
  adapterProfileLabel,
  adapterProfileMode,
  adapterResolvedMethods,
}: SettingsRuntimeSectionProps) {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <div className="settings-section-title">{t('automation')}</div>
          <div className="settings-section-subtitle">{t('automationSubtitle')}</div>
        </div>
      </div>
      <div className="settings-grid">
        <div className="settings-card">
          <label className="toggle">
            <input type="checkbox" checked={autoSubscribe} onChange={(e) => setAutoSubscribe(e.target.checked)} />
            {t('autoSubscribeRooms')}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={autoClaim} onChange={(e) => setAutoClaim(e.target.checked)} />
            {t('autoClaimOwnership')}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
            {t('autoRenewTtl')}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={loadedOnly} onChange={(e) => setLoadedOnly(e.target.checked)} />
            {t('showLoadedOnly')}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showTimeline} onChange={(e) => setShowTimeline(e.target.checked)} />
            {t('showTimeline')}
          </label>
        </div>
        <div className="settings-card">
          <div className="settings-title">{t('appearance')}</div>
          <div className="settings-row">
            <span>{t('themeLabel')}</span>
            <div className="segmented">
              <button className={`segmented-item ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>
                {t('light')}
              </button>
              <button className={`segmented-item ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>
                {t('dark')}
              </button>
            </div>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-title">{t('codexTransport')}</div>
          <div className="settings-body">{t('codexTransportSubtitle')}</div>
          <div className="settings-row">
            <div className="segmented">
              <button
                className={`segmented-item ${codexTransport === 'embedded_ws' ? 'active' : ''}`}
                onClick={() => setCodexTransport('embedded_ws')}
              >
                {t('embeddedTransport')}
              </button>
              <button className={`segmented-item ${codexTransport === 'stdio' ? 'active' : ''}`} onClick={() => setCodexTransport('stdio')}>
                {t('stdioTransport')}
              </button>
            </div>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-title">{t('connection')}</div>
          <div className="settings-row">
            <span>{t('status')}</span>
            <span className={`status-chip ${connected ? 'ok' : 'bad'}`}>{connected ? t('connected') : t('disconnected')}</span>
          </div>
          <div className="settings-row">
            <span>{t('client')}</span>
            <span className="settings-value">{clientId || t('none')}</span>
          </div>
          <div className="settings-row">
            <span>{t('roomLabel')}</span>
            <span className="settings-value">{threadId || t('none')}</span>
          </div>
          <div className="settings-row">
            <span>{t('wsUrl')}</span>
            <span className="settings-value">{wsUrl}</span>
          </div>
          <div className="settings-row">
            <span>{t('agentType')}</span>
            <span className="settings-value">{conversationTypeLabel}</span>
          </div>
          <div className="settings-row">
            <span>{t('switchAgentType')}</span>
            <select
              className="runtime-agent-select"
              value={conversationType}
              onChange={(event) => onConversationTypeChange?.(event.target.value as typeof conversationType)}
            >
              {conversationTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <span>{t('adapterProfile')}</span>
            <span className={`settings-value ${adapterProfileMode === 'compatibility' ? 'settings-value-warn' : ''}`}>
              {adapterProfileLabel}
            </span>
          </div>
          <div className="settings-row">
            <span>{t('adapterMethodResolution')}</span>
            <span className="settings-value">{t('adapterMethodResolutionHint')}</span>
          </div>
          {adapterResolvedMethods.map((entry) => (
            <div key={entry.action} className="settings-row" data-testid={`adapter-method-${entry.action}`}>
              <span>{entry.label}</span>
              <span className={`settings-value settings-value-code ${entry.method ? '' : 'settings-value-warn'}`} data-testid={`adapter-method-value-${entry.action}`}>
                {entry.method ?? t('adapterMethodUnresolved')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
