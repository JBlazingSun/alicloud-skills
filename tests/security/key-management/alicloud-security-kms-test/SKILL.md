---
name: alicloud-security-kms-test
description: Minimal smoke test for KMS skill. Validate auth and read-only key listing path.
---

Category: test

# KMS 最小可用测试

## 前置条件

- 已配置 AK/SK 与 region。
- 目标技能：`skills/security/key-management/alicloud-security-kms/`。

## 测试步骤

1) 通过 OpenAPI 元数据确认 KMS 常用读取 API。
2) 执行一个只读查询（如 `ListKeys` 或产品支持的等价读接口）。
3) 记录 request id、返回数量、错误码（若有）。

## 期望结果

- 只读查询成功或返回明确权限错误。
