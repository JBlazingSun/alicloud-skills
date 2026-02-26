type SettingsGitSectionProps = {
  t: (key: string) => string;
  gitBranchPrefix: string;
  setGitBranchPrefix: (value: string) => void;
  gitForcePush: boolean;
  setGitForcePush: (value: boolean) => void;
  gitCommitInstructions: string;
  setGitCommitInstructions: (value: string) => void;
  gitPrInstructions: string;
  setGitPrInstructions: (value: string) => void;
};

export function SettingsGitSection({
  t,
  gitBranchPrefix,
  setGitBranchPrefix,
  gitForcePush,
  setGitForcePush,
  gitCommitInstructions,
  setGitCommitInstructions,
  gitPrInstructions,
  setGitPrInstructions,
}: SettingsGitSectionProps) {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <div className="settings-section-title">{t('git')}</div>
          <div className="settings-section-subtitle">{t('gitSubtitle')}</div>
        </div>
      </div>
      <div className="settings-grid">
        <div className="settings-card">
          <div className="settings-title">{t('branchPrefix')}</div>
          <input className="settings-input" value={gitBranchPrefix} onChange={(e) => setGitBranchPrefix(e.target.value)} placeholder="animus/" />
        </div>
        <div className="settings-card">
          <div className="settings-title">{t('alwaysForcePush')}</div>
          <label className="toggle">
            <input type="checkbox" checked={gitForcePush} onChange={(e) => setGitForcePush(e.target.checked)} />
            {t('forceWithLease')}
          </label>
        </div>
        <div className="settings-card">
          <div className="settings-title">{t('commitInstructions')}</div>
          <textarea
            className="settings-textarea"
            rows={5}
            value={gitCommitInstructions}
            onChange={(e) => setGitCommitInstructions(e.target.value)}
            placeholder={t('commitInstructions')}
          />
        </div>
        <div className="settings-card">
          <div className="settings-title">{t('prInstructions')}</div>
          <textarea
            className="settings-textarea"
            rows={5}
            value={gitPrInstructions}
            onChange={(e) => setGitPrInstructions(e.target.value)}
            placeholder={t('prInstructions')}
          />
        </div>
      </div>
    </div>
  );
}
