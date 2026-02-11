---
name: alicloud-security-cloudfw-test
description: Minimal smoke test for Cloud Firewall skill. Validate read-only inventory query path.
---

Category: test

# CloudFW 最小可用测试

## 前置条件

- 已配置 AK/SK 与 region。
- 目标技能：`skills/security/firewall/alicloud-security-cloudfw/`。

## 测试步骤

1) 先跑元数据 API 列表脚本。
2) 选择一个只读列表/详情 API 执行。
3) 记录请求摘要和响应摘要。

## 期望结果

- 可拿到资源列表或明确无权限提示。
