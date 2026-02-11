---
name: alicloud-security-center-sas-test
description: Minimal smoke test for Security Center SAS skill. Validate read-only query flow.
---

Category: test

# SAS 最小可用测试

## 前置条件

- 已配置 AK/SK 与 region。
- 目标技能：`skills/security/host/alicloud-security-center-sas/`。

## 测试步骤

1) 获取 SAS 的 API 列表。
2) 执行一个只读查询 API。
3) 记录成功/失败及错误码。

## 期望结果

- 请求链路可达，返回可解析 JSON。
