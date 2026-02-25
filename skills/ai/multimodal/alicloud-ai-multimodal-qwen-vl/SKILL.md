---
name: alicloud-ai-multimodal-qwen-vl
description: Understand images with Alibaba Cloud Model Studio Qwen VL models (qwen3-vl-plus/qwen3-vl-flash and latest aliases). Use when building image Q&A, visual analysis, OCR-like extraction, chart/table reading, or screenshot understanding workflows.
---

Category: provider

# Model Studio Qwen VL (Image Understanding)

Use Qwen VL models for image input + text output understanding tasks via DashScope compatible-mode API.

## Prerequisites

- Install dependencies (recommended in a venv):

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install requests
```

- Set `DASHSCOPE_API_KEY` in environment, or add `dashscope_api_key` to `~/.alibabacloud/credentials`.

## Critical model names

Prefer the Qwen3 VL family:
- `qwen3-vl-plus`
- `qwen3-vl-flash`

When you need explicit "latest" routing or reproducible snapshots, use supported aliases/snapshots from the official model list, such as:
- `qwen3-vl-plus-latest`
- `qwen3-vl-plus-2025-12-19`
- `qwen3-vl-flash-latest`

Legacy names still seen in some workloads:
- `qwen-vl-max-latest`
- `qwen-vl-plus-latest`

## Normalized interface (multimodal.chat)

### Request

- `prompt` (string, required): user question/instruction about image.
- `image` (string, required): HTTPS URL, local path, or `data:` URL.
- `model` (string, optional): default `qwen3-vl-plus`.
- `max_tokens` (int, optional): default `512`.
- `temperature` (float, optional): default `0.2`.
- `detail` (string, optional): `auto`/`low`/`high`, default `auto`.

### Response

- `text` (string): primary model answer.
- `model` (string): model actually used.
- `usage` (object): token usage if returned by backend.

## Quickstart

```bash
python skills/ai/multimodal/alicloud-ai-multimodal-qwen-vl/scripts/analyze_image.py \
  --request '{"prompt":"请概括这张图里的主要内容","image":"https://example.com/demo.jpg"}' \
  --print-response
```

Using local image:

```bash
python skills/ai/multimodal/alicloud-ai-multimodal-qwen-vl/scripts/analyze_image.py \
  --request '{"prompt":"提取图片中的关键信息","image":"./samples/invoice.png","model":"qwen3-vl-plus"}' \
  --print-response
```

## cURL (compatible mode)

```bash
curl -sS https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"qwen3-vl-plus",
    "messages":[
      {
        "role":"user",
        "content":[
          {"type":"image_url","image_url":{"url":"https://example.com/demo.jpg"}},
          {"type":"text","text":"请描述这张图并列出可执行动作"}
        ]
      }
    ],
    "max_tokens":512,
    "temperature":0.2
  }'
```

## Output location

- If `--output` is set, JSON response is saved to that file.
- Default output dir convention: `output/ai-multimodal-qwen-vl/`.

## Error handling

| Error | Likely cause | Action |
| --- | --- | --- |
| 401/403 | Missing or invalid key | Check `DASHSCOPE_API_KEY` and account permissions. |
| 400 | Invalid request schema or unsupported image source | Validate `messages` content and image URL/path format. |
| 429 | Rate limit | Retry with exponential backoff and lower concurrency. |
| 5xx | Temporary backend issue | Retry with backoff and idempotent request design. |

## Operational guidance

- For stable production behavior, pin snapshot model IDs instead of pure `-latest`.
- Compress very large images before upload to reduce latency and cost.
- Add explicit extraction constraints in prompt (fields, JSON shape, language).
- For OCR-like output, ask for confidence notes and unresolved text markers.

## References

- Source list: `references/sources.md`
- API notes: `references/api_reference.md`
