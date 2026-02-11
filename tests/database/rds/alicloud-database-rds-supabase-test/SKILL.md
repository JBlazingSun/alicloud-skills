---
name: alicloud-database-rds-supabase-test
description: Minimal smoke test for RDS Supabase skill. Validate endpoint reachability and one list/detail API.
---

Category: test

# RDS Supabase 最小可用测试

## 前置条件

- 已配置 AK/SK 与 region。
- 目标技能：`skills/database/rds/alicloud-database-rds-supabase/`。

## 测试步骤

1) 读取技能中 API 基础信息。
2) 调用一个只读列表或详情 API。
3) 记录实例数或错误码。

## 期望结果

- 可完成一次最小只读调用。
