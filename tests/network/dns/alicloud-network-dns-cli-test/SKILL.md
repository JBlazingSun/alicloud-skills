---
name: alicloud-network-dns-cli-test
description: Minimal smoke test for Alibaba Cloud DNS CLI skill. Validate aliyun-cli auth and describe-subdomain flow.
---

Category: test

# DNS CLI 最小可用测试

## 前置条件

- 已安装并配置 `aliyun` CLI。
- 已配置 AK/SK。
- 目标技能：`skills/network/dns/alicloud-network-dns-cli/`。

## 测试步骤

1) 执行 `aliyun alidns DescribeSubDomainRecords --DomainName <domain> --SubDomain <sub>`。
2) 若无记录，再执行一次空返回验证。
3) 记录 request id 和返回条目数。

## 期望结果

- 命令可执行，返回 JSON 或明确权限错误。
