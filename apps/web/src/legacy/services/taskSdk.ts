import type { RpcClient } from '../lib/rpcClient';

export type AgentTask = {
  id: string;
  name: string;
  prompt: string;
  workspacePath?: string;
  threadId?: string;
  scheduleMinutes: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastRunStatus?: string;
  lastError?: string;
};

export type TaskListResult = { tasks: AgentTask[] };
export type TaskResult = { task: AgentTask };

export class TaskSdk {
  constructor(private readonly rpc: RpcClient) {}

  list(): Promise<TaskListResult> {
    return this.rpc.request<TaskListResult>('task/list');
  }

  create(payload: {
    name: string;
    prompt: string;
    workspacePath?: string;
    scheduleMinutes: number;
    enabled: boolean;
  }): Promise<TaskResult> {
    return this.rpc.request<TaskResult>('task/create', payload);
  }

  update(payload: {
    id: string;
    name?: string;
    prompt?: string;
    workspacePath?: string;
    scheduleMinutes?: number;
    enabled?: boolean;
  }): Promise<TaskResult> {
    return this.rpc.request<TaskResult>('task/update', payload);
  }

  delete(id: string): Promise<{ ok: boolean }> {
    return this.rpc.request<{ ok: boolean }>('task/delete', { id });
  }

  toggle(id: string, enabled: boolean): Promise<TaskResult> {
    return this.rpc.request<TaskResult>('task/toggle', { id, enabled });
  }

  run(id: string): Promise<{ ok: boolean }> {
    return this.rpc.request<{ ok: boolean }>('task/run', { id });
  }
}

export const createTaskSdk = (rpc: RpcClient) => new TaskSdk(rpc);
