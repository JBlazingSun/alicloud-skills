---
name: alicloud-observability-sls-log-query-test
description: Minimal smoke test for SLS log query skill. Validate SDK auth and one bounded query.
---

Category: test

# SLS 日志查询最小可用测试

## 前置条件

- 配置 `ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET`。
- 配置 `SLS_ENDPOINT`、`SLS_PROJECT`、`SLS_LOGSTORE`。
- 目标技能：`skills/observability/sls/alicloud-observability-sls-log-query/`。

## 测试步骤

1) 执行 5 分钟窗口的基础查询（如 `* | select count(*)`）。
2) 记录耗时与返回行数。
3) 若失败，记录完整错误码。

## 期望结果

- 查询成功返回统计结果，或返回可诊断错误。
