---
name: alicloud-compute-swas-open
description: Manage Alibaba Cloud Simple Application Server (SWAS OpenAPI 2020-06-01) resources end-to-end. Use for querying instances, starting/stopping/rebooting, executing commands (cloud assistant), managing disks/snapshots/images, firewall rules/templates, key pairs, tags, monitoring, and lightweight database operations.
---

Category: service

# 轻量应用服务器（SWAS-OPEN 2020-06-01）

使用 SWAS-OPEN OpenAPI 管控轻量应用服务器的全量资源：实例、磁盘、快照、镜像、密钥对、防火墙、命令助手、监控、标签、轻量数据库等。

## 前置要求

- 准备 AccessKey（建议 RAM 用户/角色最小权限）。
- 选择正确 Region 并使用对应接入点（公网/VPC）。
- 该产品 OpenAPI 为 RPC 签名风格，优先使用官方 SDK 或 OpenAPI Explorer，避免手写签名。

## 工作流

1) 明确资源类型与 Region（实例/磁盘/快照/镜像/防火墙/命令/数据库/标签）。  
2) 在 `references/api_overview.md` 中确定 API 组与具体接口。  
3) 选择调用方式（SDK / OpenAPI Explorer / 自签名）。  
4) 执行变更后，用查询接口校验状态或结果。  

## 常见操作映射

- 实例查询/启动/停止/重启：`ListInstances`、`StartInstance(s)`、`StopInstance(s)`、`RebootInstance(s)`  
- 执行命令：`RunCommand` 或 `CreateCommand` + `InvokeCommand`，结果用 `DescribeInvocations`/`DescribeInvocationResult`  
- 防火墙：`ListFirewallRules`/`CreateFirewallRule(s)`/`ModifyFirewallRule`/`EnableFirewallRule`/`DisableFirewallRule`  
- 快照/磁盘/镜像：`CreateSnapshot`、`ResetDisk`、`CreateCustomImage` 等  

## 命令助手执行提示

- 目标实例必须为运行中（Running）。
- 需要安装云助手 Agent（可通过 `InstallCloudAssistant` 安装）。
- PowerShell 命令需确保 Windows 实例已配置 PowerShell 模块。
- 执行后用 `DescribeInvocations` 或 `DescribeInvocationResult` 取回结果与状态。

详见 `references/command-assistant.md`。

## 选择问题（不确定时提问）

1. 目标 Region 是什么？是否需要 VPC 接入点？
2. 目标实例 ID 列表是什么？实例当前状态是否为 Running？
3. 要执行的命令内容/脚本类型/超时时间？Linux 还是 Windows？
4. 是否需要批量操作或定时执行？

## Output Policy

若需保存结果或响应，写入：
`output/compute-swas-open/`

## References

- API 总览与接口分组：`references/api_overview.md`
- 接入点与集成方式：`references/endpoints.md`
- 命令助手要点：`references/command-assistant.md`
- 官方文档来源清单：`references/sources.md`
