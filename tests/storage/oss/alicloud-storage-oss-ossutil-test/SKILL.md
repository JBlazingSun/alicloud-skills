---
name: alicloud-storage-oss-ossutil-test
description: Minimal OSSUTIL 2.0 smoke tests. Validate config, list bucket, and upload/download with OSS.
---

Category: test

# OSSUTIL 2.0 最小可用测试

## 目标

- 验证 AK/Region 配置正确。
- 验证 OSS 访问（列桶、上传、下载）。

## 前置条件

- 已配置 AK（推荐环境变量或 `~/.alibabacloud/credentials`）。
- 已准备一个可读写的 OSS Bucket。

## 测试步骤（最小）

1) 查看配置

```bash
ossutil config -e
```

2) 列出 Bucket

```bash
ossutil ls
```

3) 上传小文件

```bash
echo "ossutil-test" > /tmp/ossutil-test.txt
ossutil cp /tmp/ossutil-test.txt oss://<bucket>/tests/ossutil-test.txt
```

4) 下载并校验

```bash
ossutil cp oss://<bucket>/tests/ossutil-test.txt /tmp/ossutil-test-down.txt
cat /tmp/ossutil-test-down.txt
```

## 期望结果

- `ossutil ls` 能返回至少一个 bucket 或无权限说明。
- 上传/下载成功，文件内容一致。

## 常见失败

- Region 不匹配：确认 `ALICLOUD_REGION_ID` 或配置文件中的 region。
- AK 无权限：确认 RAM 策略允许 `oss:*` 或最小读写权限。
