---
name: alicloud-compute-ecs-test
description: Minimal smoke test for ECS skill. Validate auth, region reachability, and DescribeInstances query path.
---

Category: test

# ECS 最小可用测试

## 前置条件

- 已配置 `ALICLOUD_ACCESS_KEY_ID` / `ALICLOUD_ACCESS_KEY_SECRET` / `ALICLOUD_REGION_ID`。
- 目标技能：`skills/compute/ecs/alicloud-compute-ecs/`。

## 测试步骤

1) 执行最小查询：`DescribeRegions`。
2) 在一个 region 执行 `DescribeInstances`（`PageSize=1`）。
3) 记录请求参数、返回总数、是否成功。

## 期望结果

- API 可达，返回结构正常。
- 无实例时返回空列表，不应报鉴权错误。
