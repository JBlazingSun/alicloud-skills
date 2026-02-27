---
name: alicloud-ai-audio-asr-test
description: Minimal non-realtime ASR smoke test for Model Studio Qwen ASR.
---

Category: test

# 最小可用测试

## 目标

- 仅验证非实时 ASR 最小请求链路可用。
- 失败时记录错误信息，不猜参数。

## 前置条件

- 按技能说明准备认证信息与 Region。
- 参考技能目录：`skills/ai/audio/alicloud-ai-audio-asr`

## 测试步骤（最小）

1) 打开对应技能的 `SKILL.md`，选择一个最小输入示例。
2) 运行示例脚本或发起最小请求。
3) 记录：请求摘要 / 返回摘要 / 成功或失败原因。

## 推荐最小命令

```bash
python skills/ai/audio/alicloud-ai-audio-asr/scripts/transcribe_audio.py \
  --audio "https://dashscope.oss-cn-beijing.aliyuncs.com/audios/welcome.mp3" \
  --model qwen3-asr-flash \
  --print-response
```

## 结果记录模板

- 时间：YYYY-MM-DD
- 技能：`skills/ai/audio/alicloud-ai-audio-asr`
- 结论：pass / fail
- 备注：
