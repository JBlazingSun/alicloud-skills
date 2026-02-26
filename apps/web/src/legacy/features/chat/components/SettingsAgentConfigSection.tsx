import { TomlCodeEditor } from '../../shared/TomlCodeEditor';

type SettingsAgentConfigSectionProps = {
  t: (key: string) => string;
  configDirty: boolean;
  configPath: string;
  configText: string;
  configLoading: boolean;
  setConfigText: (value: string) => void;
  setConfigDirty: (value: boolean) => void;
  saveConfig: () => Promise<void>;
  loadConfig: () => Promise<void>;
  formatConfig: () => void;
  openLicenses: () => void;
};

export function SettingsAgentConfigSection({
  t,
  configDirty,
  configPath,
  configText,
  configLoading,
  setConfigText,
  setConfigDirty,
  saveConfig,
  loadConfig,
  formatConfig,
  openLicenses,
}: SettingsAgentConfigSectionProps) {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <div className="settings-section-title">{t('agentConfig')}</div>
          <div className="settings-section-subtitle">{t('configSubtitle')}</div>
        </div>
      </div>
      <div className="settings-grid">
        <div className="settings-card">
          <div className="settings-title">{t('configEditorTitle')}</div>
          <div className="settings-body">{t('configEditorSubtitle')}</div>
          {configDirty && <div className="panel-hint">{t('configDirty')}</div>}
          <div className="settings-row">
            <span>{t('configPath')}</span>
            <span className="settings-value">{configPath || '~/.animus/agent/config.toml'}</span>
          </div>
          <div className="config-editor" aria-label="TOML editor">
            <TomlCodeEditor
              value={configText}
              onChange={(next) => {
                setConfigText(next);
                setConfigDirty(true);
              }}
              onSave={() => {
                void saveConfig();
              }}
            />
          </div>
          <div className="settings-actions">
            <button className="pill pill-ghost" onClick={() => void loadConfig()} disabled={configLoading}>
              {t('configLoad')}
            </button>
            <button className="pill pill-ghost" onClick={formatConfig} disabled={configLoading}>
              {t('configFormat')}
            </button>
            <button className="pill" onClick={() => void saveConfig()} disabled={configLoading}>
              {t('configSave')}
            </button>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-title">{t('licenses')}</div>
          <div className="settings-row">
            <span>{t('thirdPartyNotices')}</span>
            <button className="pill" onClick={openLicenses}>
              {t('view')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
