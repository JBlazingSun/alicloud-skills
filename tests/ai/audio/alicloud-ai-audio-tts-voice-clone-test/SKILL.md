---
name: alicloud-ai-audio-tts-voice-clone-test
description: Minimal voice cloning TTS smoke test for Model Studio Qwen TTS VC.
---

Category: test

# 最小可用测试

## 目标

- 仅验证该技能的最小请求链路可用。
- 失败时记录错误信息，不猜参数。

## 前置条件

- 按技能说明准备认证信息与 Region。
- 参考技能目录：skills/ai/audio/alicloud-ai-audio-tts-voice-clone

## 测试步骤（最小）

1) 打开对应技能的 SKILL.md，选择一个最小输入示例。
2) 发起请求或运行示例脚本。
3) 记录：请求摘要 / 返回摘要 / 成功或失败原因。

可执行示例：

```bash
.venv/bin/python skills/ai/audio/alicloud-ai-audio-tts-voice-clone/scripts/prepare_voice_clone_request.py \
  --text "voice clone test" \
  --voice-sample "https://example.com/sample.wav"
```

通过标准：脚本返回 `{"ok": true, ...}` 且生成 `output/ai-audio-tts-voice-clone/request.json`。

## 结果记录模板

- 时间：YYYY-MM-DD
- 技能：skills/ai/audio/alicloud-ai-audio-tts-voice-clone
- 结论：pass / fail
- 备注：
