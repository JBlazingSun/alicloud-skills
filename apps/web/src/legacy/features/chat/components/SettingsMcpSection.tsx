type MpcServer = { id: string; name: string; description: string };

type SettingsMcpSectionProps = {
  t: (key: string) => string;
  tWith: (key: string, vars: Record<string, string>) => string;
  mcpCustomServers: string[];
  mcpRecommended: MpcServer[];
  mcpInstalled: Record<string, boolean>;
  onAddCustom: () => void;
  onRemoveCustom: (name: string) => void;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onOpenModal: (title: string, body: string) => void;
};

export function SettingsMcpSection({
  t,
  tWith,
  mcpCustomServers,
  mcpRecommended,
  mcpInstalled,
  onAddCustom,
  onRemoveCustom,
  onInstall,
  onUninstall,
  onOpenModal,
}: SettingsMcpSectionProps) {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <div className="settings-section-title">{t('mcpServers')}</div>
          <div className="settings-section-subtitle">{t('mcpSubtitle')}</div>
        </div>
        <button className="pill" onClick={onAddCustom}>
          {t('addServer')}
        </button>
      </div>
      <div className="settings-grid">
        {mcpCustomServers.length === 0 && (
          <div className="settings-card">
            <div className="settings-title">{t('customServers')}</div>
            <div className="settings-body">{t('noCustomServers')}</div>
            <div className="settings-actions">
              <button className="pill" onClick={onAddCustom}>
                {t('addServer')}
              </button>
            </div>
          </div>
        )}
        {mcpCustomServers.map((name) => (
          <div key={name} className="settings-card">
            <div className="settings-title">{name}</div>
            <div className="settings-body">{t('customMcpLabel')}</div>
            <div className="settings-actions">
              <button className="pill" onClick={() => onOpenModal(tWith('mcpServerTitle', { name }), t('mcpCustomModalBody'))}>
                {t('mcpDetails')}
              </button>
              <button className="pill" onClick={() => onRemoveCustom(name)}>
                {t('remove')}
              </button>
            </div>
          </div>
        ))}
        {mcpRecommended.map((server) => {
          const installed = !!mcpInstalled[server.id];
          return (
            <div key={server.id} className="settings-card">
              <div className="settings-title">{server.name}</div>
              <div className="settings-body">{server.description}</div>
              <div className="settings-actions">
                {!installed ? (
                  <button className="pill" onClick={() => onInstall(server.id)}>
                    {t('install')}
                  </button>
                ) : (
                  <>
                    <button
                      className="pill"
                      onClick={() => onOpenModal(tWith('mcpServerTitle', { name: server.name }), t('mcpInstallModalBody'))}
                    >
                      {t('configure')}
                    </button>
                    <button className="pill" onClick={() => onUninstall(server.id)}>
                      {t('uninstall')}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
