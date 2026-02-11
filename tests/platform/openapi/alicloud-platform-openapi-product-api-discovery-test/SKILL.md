---
name: alicloud-platform-openapi-product-api-discovery-test
description: Minimal smoke test for product API discovery skill. Validate product pull, merge, and one metadata fetch.
---

Category: test

# OpenAPI 产品发现最小可用测试

## 前置条件

- 已配置 AK/SK。
- 目标技能：`skills/platform/openapi/alicloud-platform-openapi-product-api-discovery/`。

## 测试步骤

1) 运行一个产品源抓取脚本。
2) 运行合并脚本。
3) 限制 `OPENAPI_META_MAX_PRODUCTS=1` 执行元数据抓取。

## 期望结果

- `output/product-scan/` 下产生最小结果文件。
