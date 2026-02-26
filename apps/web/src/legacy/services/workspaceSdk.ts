import type { RpcClient } from '../lib/rpcClient';

export type WorkspaceInfo = {
  id: string;
  path: string;
  name: string;
  active: boolean;
  exists: boolean;
};

export type WorkspaceSnapshot = {
  workspaces: WorkspaceInfo[];
  activePath?: string | null;
  threadProjects?: Record<string, string>;
  recentPaths?: string[];
  favoritePaths?: string[];
};

export type BrowseDirectoryItem = {
  name: string;
  path: string;
};

export type WorkspaceBrowseResult = {
  currentPath: string;
  parentPath?: string | null;
  directories: BrowseDirectoryItem[];
  nextCursor?: number | null;
  limit?: number;
};

export type WorkspaceBrowseQuery = {
  path?: string;
  search?: string;
  cursor?: number;
  limit?: number;
};

export type ThreadWorkspaceResult = {
  threadId: string;
  workspacePath?: string | null;
  threadProjects?: Record<string, string>;
  recentPaths?: string[];
};

export type WorkspacePreferencesResult = {
  recentPaths: string[];
  favoritePaths: string[];
};

export type WorktreeInfo = {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  active: boolean;
};

export type WorktreeListResult = {
  workspacePath: string;
  worktrees: WorktreeInfo[];
};

export type WorktreeCreateResult = {
  createdPath: string;
  activePath?: string | null;
  workspaces: WorkspaceInfo[];
  threadProjects?: Record<string, string>;
  recentPaths?: string[];
  favoritePaths?: string[];
  worktrees: WorktreeInfo[];
};

export type WorktreeRemoveResult = {
  activePath?: string | null;
  workspaces: WorkspaceInfo[];
  threadProjects?: Record<string, string>;
  recentPaths?: string[];
  favoritePaths?: string[];
  worktrees: WorktreeInfo[];
};

export class WorkspaceSdk {
  constructor(private readonly rpc: RpcClient) {}

  list(): Promise<WorkspaceSnapshot> {
    return this.rpc.request<WorkspaceSnapshot>('workspace/list');
  }

  browse(query?: string | WorkspaceBrowseQuery): Promise<WorkspaceBrowseResult> {
    if (typeof query === 'string') {
      return this.rpc.request<WorkspaceBrowseResult>('workspace/browse', { path: query });
    }
    return this.rpc.request<WorkspaceBrowseResult>('workspace/browse', query ?? {});
  }

  add(path: string): Promise<WorkspaceSnapshot> {
    return this.rpc.request<WorkspaceSnapshot>('workspace/add', { path });
  }

  remove(path: string): Promise<WorkspaceSnapshot> {
    return this.rpc.request<WorkspaceSnapshot>('workspace/remove', { path });
  }

  activate(path: string): Promise<WorkspaceSnapshot> {
    return this.rpc.request<WorkspaceSnapshot>('workspace/activate', { path });
  }

  getThreadWorkspace(threadId: string): Promise<ThreadWorkspaceResult> {
    return this.rpc.request<ThreadWorkspaceResult>('workspace/thread/get', { threadId });
  }

  setThreadWorkspace(threadId: string, path?: string | null): Promise<ThreadWorkspaceResult> {
    return this.rpc.request<ThreadWorkspaceResult>('workspace/thread/set', { threadId, path: path ?? null });
  }

  getPreferences(): Promise<WorkspacePreferencesResult> {
    return this.rpc.request<WorkspacePreferencesResult>('workspace/preferences/get');
  }

  touchRecent(path: string): Promise<WorkspacePreferencesResult> {
    return this.rpc.request<WorkspacePreferencesResult>('workspace/preferences/touch', { path });
  }

  toggleFavorite(path: string): Promise<WorkspacePreferencesResult> {
    return this.rpc.request<WorkspacePreferencesResult>('workspace/preferences/toggleFavorite', { path });
  }

  listWorktrees(path?: string): Promise<WorktreeListResult> {
    return this.rpc.request<WorktreeListResult>('workspace/worktree/list', path ? { path } : {});
  }

  createWorktree(sourcePath: string, branch: string, targetPath?: string): Promise<WorktreeCreateResult> {
    const payload: { sourcePath: string; branch: string; targetPath?: string } = { sourcePath, branch };
    if (targetPath) payload.targetPath = targetPath;
    return this.rpc.request<WorktreeCreateResult>('workspace/worktree/create', payload);
  }

  removeWorktree(sourcePath: string, path: string, force = true): Promise<WorktreeRemoveResult> {
    return this.rpc.request<WorktreeRemoveResult>('workspace/worktree/remove', { sourcePath, path, force });
  }
}

export const createWorkspaceSdk = (rpc: RpcClient) => new WorkspaceSdk(rpc);
