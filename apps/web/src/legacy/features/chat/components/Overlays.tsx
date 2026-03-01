import type { ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist';

function useFocusTrap(open: boolean, containerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!open || !container) return;
    const focusables = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first?.focus();

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || focusables.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    container.addEventListener('keydown', onKeydown);
    return () => container.removeEventListener('keydown', onKeydown);
  }, [open, containerRef]);
}

type InfoModalProps = {
  open: boolean;
  title: string;
  body: string;
  closeLabel: string;
  onClose: () => void;
};

export function InfoModal({ open, title, body, closeLabel, onClose }: InfoModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(open, dialogRef);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" id="modal-title">
            {title}
          </div>
          <button className="pill pill-ghost" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        <div className="modal-body">{body}</div>
      </div>
    </div>
  );
}

type InputModalProps = {
  open: boolean;
  title: string;
  value: string;
  placeholder: string;
  closeLabel: string;
  saveLabel: string;
  onChange: (nextValue: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function InputModal({
  open,
  title,
  value,
  placeholder,
  closeLabel,
  saveLabel,
  onChange,
  onClose,
  onSubmit,
}: InputModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(open, dialogRef);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="input-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" id="input-modal-title">
            {title}
          </div>
          <button className="pill pill-ghost" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        <form
          className="modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input
            autoFocus
            value={value}
            className="settings-input"
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
          />
          <div className="settings-actions">
            <button type="button" className="pill pill-ghost" onClick={onClose}>
              {closeLabel}
            </button>
            <button type="submit" className="pill" disabled={!value.trim()}>
              {saveLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type AuthModalProps = {
  open: boolean;
  title: string;
  usernameLabel: string;
  passwordLabel: string;
  usernamePlaceholder: string;
  passwordPlaceholder: string;
  closeLabel: string;
  submitLabel: string;
  username: string;
  password: string;
  errorText?: string;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function AuthModal({
  open,
  title,
  usernameLabel,
  passwordLabel,
  usernamePlaceholder,
  passwordPlaceholder,
  closeLabel,
  submitLabel,
  username,
  password,
  errorText,
  onUsernameChange,
  onPasswordChange,
  onClose,
  onSubmit,
}: AuthModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(open, dialogRef);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" id="auth-modal-title">
            {title}
          </div>
          <button className="pill pill-ghost" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        <form
          className="modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label className="input-label">
            {usernameLabel}
            <input
              autoFocus
              value={username}
              className="settings-input"
              onChange={(event) => onUsernameChange(event.target.value)}
              placeholder={usernamePlaceholder}
            />
          </label>
          <label className="input-label">
            {passwordLabel}
            <input
              type="password"
              value={password}
              className="settings-input"
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder={passwordPlaceholder}
            />
          </label>
          {errorText ? <div className="toast-error">{errorText}</div> : null}
          <div className="settings-actions">
            <button type="button" className="pill pill-ghost" onClick={onClose}>
              {closeLabel}
            </button>
            <button type="submit" className="pill" disabled={!username.trim() || !password.trim()}>
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type DirectoryEntry = {
  name: string;
  path: string;
};

type BrowseResult = {
  currentPath: string;
  parentPath?: string | null;
  directories: DirectoryEntry[];
  nextCursor?: number | null;
};

type BrowseQuery = {
  path?: string;
  search?: string;
  cursor?: number;
  limit?: number;
};

type DirectoryTreeNode = {
  id: string;
  name: string;
  path: string;
  loaded: boolean;
  children: DirectoryTreeNode[];
};

type DirectoryBrowserModalProps = {
  open: boolean;
  title: string;
  startPath?: string;
  closeLabel: string;
  refreshLabel: string;
  upLabel: string;
  openAsRootLabel: string;
  goLabel: string;
  pathPlaceholder: string;
  searchPlaceholder: string;
  recentLabel: string;
  favoritesLabel: string;
  loadMoreLabel: string;
  favoriteLabel: string;
  unfavoriteLabel: string;
  selectCurrentLabel: string;
  addLabel: string;
  activateLabel: string;
  addAndActivateLabel: string;
  statusAddedLabel: string;
  statusActiveLabel: string;
  emptyLabel: string;
  recentPaths: string[];
  favoritePaths: string[];
  fetchDirectories: (query?: string | BrowseQuery) => Promise<BrowseResult>;
  onSelectCurrent: (path: string) => void;
  onAddPath: (path: string) => void | Promise<void>;
  onActivatePath: (path: string) => void | Promise<void>;
  onToggleFavorite: (path: string) => void | Promise<void>;
  onTouchRecent: (path: string) => void | Promise<void>;
  isWorkspaceAdded: (path: string) => boolean;
  isWorkspaceActive: (path: string) => boolean;
  isWorkspaceFavorite: (path: string) => boolean;
  onClose: () => void;
};

export function DirectoryBrowserModal({
  open,
  title,
  startPath,
  closeLabel,
  refreshLabel,
  upLabel,
  openAsRootLabel,
  goLabel,
  pathPlaceholder,
  searchPlaceholder,
  recentLabel,
  favoritesLabel,
  loadMoreLabel,
  favoriteLabel,
  unfavoriteLabel,
  selectCurrentLabel,
  addLabel,
  activateLabel,
  addAndActivateLabel,
  statusAddedLabel,
  statusActiveLabel,
  emptyLabel,
  recentPaths,
  favoritePaths,
  fetchDirectories,
  onSelectCurrent,
  onAddPath,
  onActivatePath,
  onToggleFavorite,
  onTouchRecent,
  isWorkspaceAdded,
  isWorkspaceActive,
  isWorkspaceFavorite,
  onClose,
}: DirectoryBrowserModalProps) {
  const [treeData, setTreeData] = useState<DirectoryTreeNode[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(open, dialogRef);

  const baseName = useCallback((path: string) => {
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || normalized || '/';
  }, []);

  const toTreeNode = useCallback((entry: DirectoryEntry): DirectoryTreeNode => {
    return {
      id: entry.path,
      name: entry.name,
      path: entry.path,
      loaded: false,
      children: [],
    };
  }, []);

  const replaceNodeChildren = useCallback(
    (nodes: DirectoryTreeNode[], path: string, children: DirectoryTreeNode[]): DirectoryTreeNode[] => {
      return nodes.map((node) => {
        if (node.path === path) {
          return { ...node, loaded: true, children };
        }
        if (!node.children.length) return node;
        return { ...node, children: replaceNodeChildren(node.children, path, children) };
      });
    },
    []
  );

  const loadAsRoot = useCallback(async (path?: string, search?: string) => {
    setLoading(true);
    setError('');
    try {
      const query: BrowseQuery = { limit: 200 };
      if (path) query.path = path;
      if (search) query.search = search;
      const result = await fetchDirectories(query);
      const root: DirectoryTreeNode = {
        id: result.currentPath,
        path: result.currentPath,
        name: baseName(result.currentPath),
        loaded: true,
        children: (result.directories ?? []).map(toTreeNode),
      };
      setTreeData([root]);
      setCurrentPath(result.currentPath);
      setSelectedPath(result.currentPath);
      setPathInput(result.currentPath);
      setNextCursor(result.nextCursor ?? null);
      void onTouchRecent(result.currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTreeData([]);
    } finally {
      setLoading(false);
    }
  }, [baseName, fetchDirectories, onTouchRecent, toTreeNode]);

  const loadRoot = useCallback(async () => {
    await loadAsRoot(startPath);
  }, [loadAsRoot, startPath]);

  const loadNodeChildren = useCallback(
    async (node: NodeApi<DirectoryTreeNode>) => {
      if (node.data.loaded) return;
      setError('');
      try {
        const result = await fetchDirectories({
          path: node.data.path,
          search: searchInput.trim() || undefined,
          limit: 200,
        });
        const children = (result.directories ?? []).map(toTreeNode);
        setTreeData((prev) => replaceNodeChildren(prev, node.data.path, children));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [fetchDirectories, replaceNodeChildren, searchInput, toTreeNode]
  );

  useEffect(() => {
    if (!open) return;
    void loadRoot();
  }, [loadRoot, open]);

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    window.addEventListener('click', dismiss);
    window.addEventListener('contextmenu', dismiss);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('contextmenu', dismiss);
    };
  }, [menu]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!selectedPath) {
      await loadRoot();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await fetchDirectories({
        path: selectedPath,
        search: searchInput.trim() || undefined,
        limit: 200,
      });
      const children = (result.directories ?? []).map(toTreeNode);
      setTreeData((prev) => replaceNodeChildren(prev, selectedPath, children));
      setCurrentPath(result.currentPath);
      setPathInput(result.currentPath);
      if (selectedPath === result.currentPath) {
        setNextCursor(result.nextCursor ?? null);
      }
      void onTouchRecent(result.currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [fetchDirectories, loadRoot, onTouchRecent, replaceNodeChildren, searchInput, selectedPath, toTreeNode]);

  const handleMoveUp = useCallback(async () => {
    const normalized = (currentPath || '').replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) return;
    const parent = normalized.startsWith('/') ? `/${parts.slice(0, -1).join('/')}` : parts.slice(0, -1).join('/');
    const safeParent = parent || '/';
    await loadAsRoot(safeParent, searchInput.trim() || undefined);
  }, [currentPath, loadAsRoot, searchInput]);

  const handleLoadMore = useCallback(async () => {
    if (nextCursor === null || loadingMore || !currentPath) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await fetchDirectories({
        path: currentPath,
        search: searchInput.trim() || undefined,
        cursor: nextCursor,
        limit: 200,
      });
      const moreChildren = (result.directories ?? []).map(toTreeNode);
      setTreeData((prev) => {
        if (!prev.length) return prev;
        const root = prev[0];
        const seen = new Set(root.children.map((child) => child.path));
        const merged = [...root.children, ...moreChildren.filter((child) => !seen.has(child.path))];
        return [{ ...root, children: merged }];
      });
      setNextCursor(result.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [currentPath, fetchDirectories, loadingMore, nextCursor, searchInput, toTreeNode]);

  const breadcrumbs = useMemo(() => {
    const normalized = (currentPath || '/').replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    const items: Array<{ label: string; path: string }> = [];
    if (normalized.startsWith('/')) {
      items.push({ label: '/', path: '/' });
    }
    let accumulator = normalized.startsWith('/') ? '' : '';
    for (const segment of segments) {
      accumulator = normalized.startsWith('/')
        ? `${accumulator}/${segment}`.replace(/\/{2,}/g, '/')
        : (accumulator ? `${accumulator}/${segment}` : segment);
      items.push({ label: segment, path: accumulator });
    }
    if (items.length === 0) items.push({ label: '/', path: '/' });
    return items;
  }, [currentPath]);

  const runAction = useCallback(async (action: () => void | Promise<void>) => {
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMenu(null);
    }
  }, []);

  const renderNode = useCallback(
    ({ node, style }: NodeRendererProps<DirectoryTreeNode>) => {
      const added = isWorkspaceAdded(node.data.path);
      const active = isWorkspaceActive(node.data.path);
      return (
        <div
          style={style}
          className={`workspace-tree-row ${selectedPath === node.data.path ? 'active' : ''}`}
          onClick={() => {
            node.select();
            setSelectedPath(node.data.path);
            setCurrentPath(node.data.path);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            node.select();
            setSelectedPath(node.data.path);
            setCurrentPath(node.data.path);
            setMenu({ x: event.clientX, y: event.clientY, path: node.data.path });
          }}
        >
          <button
            type="button"
            className="workspace-tree-caret"
            onClick={(event) => {
              event.stopPropagation();
              void loadNodeChildren(node).then(() => {
                node.toggle();
              });
            }}
            aria-label={node.isOpen ? 'collapse' : 'expand'}
          >
            {node.isOpen ? '▾' : '▸'}
          </button>
          <span className="workspace-tree-name">{node.data.name}</span>
          <div className="workspace-tree-tags">
            {added ? <span className="workspace-tree-tag">{statusAddedLabel}</span> : null}
            {active ? <span className="workspace-tree-tag workspace-tree-tag-active">{statusActiveLabel}</span> : null}
          </div>
        </div>
      );
    },
    [isWorkspaceActive, isWorkspaceAdded, loadNodeChildren, selectedPath, statusActiveLabel, statusAddedLabel]
  );

  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="directory-browser-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" id="directory-browser-title">
            {title}
          </div>
          <button className="pill pill-ghost" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        <div className="workspace-browser-path">
          <div className="workspace-browser-breadcrumbs">
            {breadcrumbs.map((item) => (
              <button key={item.path} type="button" className="workspace-browser-crumb" onClick={() => void loadAsRoot(item.path, searchInput.trim() || undefined)}>
                {item.label}
              </button>
            ))}
          </div>
          <code>{currentPath || '/'}</code>
          <div className="workspace-browser-jump">
            <input
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              placeholder={pathPlaceholder}
            />
            <button type="button" className="pill pill-ghost" onClick={() => void loadAsRoot(pathInput.trim() || undefined, searchInput.trim() || undefined)}>
              {goLabel}
            </button>
          </div>
          <div className="workspace-browser-search">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={searchPlaceholder}
            />
            <button type="button" className="pill pill-ghost" onClick={() => void loadAsRoot(currentPath || undefined, searchInput.trim() || undefined)}>
              {refreshLabel}
            </button>
          </div>
        </div>
        <div className="workspace-browser-shortcuts">
          <div className="workspace-browser-shortcuts-title">{favoritesLabel}</div>
          <div className="workspace-browser-shortcuts-row">
            {favoritePaths.map((path) => (
              <button key={path} type="button" className="workspace-browser-shortcut" onClick={() => void loadAsRoot(path, searchInput.trim() || undefined)}>
                {baseName(path)}
              </button>
            ))}
          </div>
          <div className="workspace-browser-shortcuts-title">{recentLabel}</div>
          <div className="workspace-browser-shortcuts-row">
            {recentPaths.map((path) => (
              <button key={path} type="button" className="workspace-browser-shortcut" onClick={() => void loadAsRoot(path, searchInput.trim() || undefined)}>
                {baseName(path)}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-actions">
          <button type="button" className="pill pill-ghost" onClick={() => void handleMoveUp()} disabled={!currentPath || loading}>
            {upLabel}
          </button>
          <button type="button" className="pill pill-ghost" onClick={() => void handleRefresh()} disabled={loading}>
            {refreshLabel}
          </button>
          <button type="button" className="pill" onClick={() => onSelectCurrent(selectedPath || currentPath)} disabled={!currentPath || loading}>
            {selectCurrentLabel}
          </button>
        </div>
        {error ? <div className="toast-error">{error}</div> : null}
        <div className="workspace-browser-list">
          {loading ? <div className="settings-body">{refreshLabel}...</div> : null}
          {!loading && treeData.length === 0 ? <div className="settings-body">{emptyLabel}</div> : null}
          {!loading && treeData.length > 0 ? (
            <Tree<DirectoryTreeNode>
              data={treeData}
              idAccessor="id"
              childrenAccessor="children"
              width="100%"
              height={320}
              rowHeight={30}
              indent={18}
              openByDefault={false}
              selection={selectedPath}
            >
              {renderNode}
            </Tree>
          ) : null}
        </div>
        {nextCursor ? (
          <div className="settings-actions">
            <button type="button" className="pill pill-ghost" onClick={() => void handleLoadMore()} disabled={loadingMore}>
              {loadMoreLabel}
            </button>
          </div>
        ) : null}
        {menu ? (
          <div
            className="workspace-tree-context-menu"
            style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
            onClick={(event) => event.stopPropagation()}
          >
            {!isWorkspaceAdded(menu.path) ? (
              <button type="button" className="workspace-tree-context-item" onClick={() => void runAction(() => onAddPath(menu.path))}>
                {addLabel}
              </button>
            ) : null}
            {!isWorkspaceActive(menu.path) ? (
              <button
                type="button"
                className="workspace-tree-context-item"
                onClick={() => void runAction(() => onActivatePath(menu.path))}
              >
                {activateLabel}
              </button>
            ) : null}
            {!isWorkspaceAdded(menu.path) && !isWorkspaceActive(menu.path) ? (
              <button
                type="button"
                className="workspace-tree-context-item"
                onClick={() => void runAction(() => onSelectCurrent(menu.path))}
              >
                {addAndActivateLabel}
              </button>
            ) : null}
            <button
              type="button"
              className="workspace-tree-context-item"
              onClick={() => void runAction(() => loadAsRoot(menu.path))}
            >
              {openAsRootLabel}
            </button>
            <button
              type="button"
              className="workspace-tree-context-item"
              onClick={() => void runAction(() => onToggleFavorite(menu.path))}
            >
              {isWorkspaceFavorite(menu.path) ? unfavoriteLabel : favoriteLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type CommandItem = {
  id: string;
  label: string;
  detail?: string;
  action: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  title: string;
  query: string;
  placeholder: string;
  emptyLabel: string;
  searchIcon: ReactNode;
  commands: CommandItem[];
  selectedIndex: number;
  onSelectedIndexChange: (next: number) => void;
  onSubmitCurrent: () => void;
  onQueryChange: (nextValue: string) => void;
  onClose: () => void;
};

export function CommandPalette({
  open,
  title,
  query,
  placeholder,
  emptyLabel,
  searchIcon,
  commands,
  selectedIndex,
  onSelectedIndexChange,
  onSubmitCurrent,
  onQueryChange,
  onClose,
}: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(open, dialogRef);
  if (!open) return null;
  return (
    <div className="command-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="command-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="command-input">
          {searchIcon}
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={placeholder}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                onSelectedIndexChange(Math.min(commands.length - 1, selectedIndex + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                onSelectedIndexChange(Math.max(0, selectedIndex - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                onSubmitCurrent();
              }
            }}
          />
        </div>
        <div className="command-list">
          {commands.length === 0 && <div className="command-empty">{emptyLabel}</div>}
          {commands.map((command, index) => (
            <button
              key={command.id}
              className={`command-item ${index === selectedIndex ? 'active' : ''}`}
              aria-pressed={index === selectedIndex}
              onMouseEnter={() => onSelectedIndexChange(index)}
              onClick={() => {
                command.action();
                onQueryChange('');
              }}
            >
              <div>
                <div className="command-label">{command.label}</div>
                {command.detail && <div className="command-detail">{command.detail}</div>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
