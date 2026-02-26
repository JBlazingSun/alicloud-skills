import type { ReactNode } from 'react';

type SkillInfo = {
  name: string;
  description?: string;
  path?: string;
};

type SkillsCatalogContentProps = {
  filter: string;
  onFilterChange: (value: string) => void;
  placeholder: string;
  loading: boolean;
  loadingLabel: string;
  error: string;
  skills: SkillInfo[];
  emptyTitle: string;
  emptyBody: string;
  noDescriptionLabel: string;
  searchIcon: ReactNode;
};

export function SkillsCatalogContent({
  filter,
  onFilterChange,
  placeholder,
  loading,
  loadingLabel,
  error,
  skills,
  emptyTitle,
  emptyBody,
  noDescriptionLabel,
  searchIcon,
}: SkillsCatalogContentProps) {
  return (
    <>
      <div className="panel-search">
        {searchIcon}
        <input value={filter} onChange={(event) => onFilterChange(event.target.value)} placeholder={placeholder} />
      </div>
      {loading && <div className="panel-hint">{loadingLabel}</div>}
      {error && <div className="toast-error">{error}</div>}
      <div className="skills-grid">
        {skills.map((skill) => (
          <div key={skill.name} className="skill-card">
            <div className="skill-name">{skill.name}</div>
            <div className="skill-desc">{skill.description ?? noDescriptionLabel}</div>
            {skill.path && <div className="skill-path">{skill.path}</div>}
          </div>
        ))}
        {!loading && skills.length === 0 && (
          <div className="empty-state">
            <div className="empty-title">{emptyTitle}</div>
            <div className="empty-body">{emptyBody}</div>
          </div>
        )}
      </div>
    </>
  );
}
