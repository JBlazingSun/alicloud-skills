---
name: alicloud-ai-multimodal-qwen-vl-test
description: Minimal image-understanding smoke test for Model Studio Qwen VL.
---

Category: test

# 最小可用测试

## 目标

- 仅验证该技能的最小请求链路可用。
- 失败时记录错误信息，不猜参数。

## 前置条件

- 按技能说明准备认证信息与 Region。
- 参考技能目录：skills/ai/multimodal/alicloud-ai-multimodal-qwen-vl

## 测试步骤（最小）

1) 打开对应技能的 SKILL.md，选择一个最小输入示例。
2) 发起请求或运行示例脚本。
3) 记录：请求摘要 / 返回摘要 / 成功或失败原因。

推荐直接运行：

```bash
python tests/ai/multimodal/alicloud-ai-multimodal-qwen-vl-test/scripts/smoke_test_qwen_vl.py \
  --image output/ai-image-qwen-image/images/vl_test_cat.png
```

通过标准：

- 返回 JSON 中 `status=pass`。
- 输出文件 `output/ai-multimodal-qwen-vl/smoke-test/result.json` 存在。
- 结果包含非空 `text`，且 `model` 与请求模型一致或同前缀。

## 结果记录模板

- 时间：YYYY-MM-DD
- 技能：skills/ai/multimodal/alicloud-ai-multimodal-qwen-vl
- 结论：pass / fail
- 备注：
