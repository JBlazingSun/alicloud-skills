import type { RpcClient } from '../lib/rpcClient';

export type InitializeResult = {
  clientId: string;
};

export type SkillInfo = {
  name: string;
  description?: string;
  path?: string;
};

export type SkillListResult = {
  skills: SkillInfo[];
};

export type ConfigGetResult = {
  path: string;
  content: string;
};

export class AgentRuntimeSdk {
  constructor(private readonly rpc: RpcClient) {}

  initialize(): Promise<InitializeResult> {
    return this.rpc.request<InitializeResult>('initialize');
  }

  listSkills(): Promise<SkillListResult> {
    return this.rpc.request<SkillListResult>('skill/list');
  }

  getSettings<T>(): Promise<T> {
    return this.rpc.request<T>('settings/get');
  }

  setSettings<T>(settings: T): Promise<T> {
    return this.rpc.request<T>('settings/set', { settings });
  }

  getConfig(): Promise<ConfigGetResult> {
    return this.rpc.request<ConfigGetResult>('config/get');
  }

  setConfig(content: string): Promise<unknown> {
    return this.rpc.request('config/set', { content });
  }
}

export const createAgentRuntimeSdk = (rpc: RpcClient) => new AgentRuntimeSdk(rpc);
