---
name: alicloud-ai-misc-crawl-and-skill
description: Refresh the Model Studio models crawl and regenerate derived summaries and `skills/ai/**` skills. Use when the models list or generated skills must be updated.
---

Category: task

# 阿里云 Model Studio 抓取与 Skills 生成

## Prerequisites

- Node.js (for `npx`)
- Python 3
- Network access to the models page

## Workflow

1) Crawl models page (raw markdown)

```bash
npx -y @just-every/crawl \"https://help.aliyun.com/zh/model-studio/models\" > alicloud-model-studio-models.md
```

2) Rebuild summary (models + API/usage links)

```bash
python3 scripts/alicloud/refresh_models_summary.py
```

3) Regenerate skills (creates/updates `skills/ai/**`)

```bash
python3 scripts/alicloud/refresh_alicloud_skills.py
```

## Outputs

- `alicloud-model-studio-models.md`: raw crawl output
- `outputs/alicloud-model-studio-models-summary.md`: cleaned summary
- `skills/ai/**`: generated skills

## Notes

- Do not invent model IDs or API endpoints; only use links present on the models page.
- After regeneration, update `README.md`, `README.zh-CN.md`, and `README.zh-TW.md` if skills list changed.
## References

- Source list: `references/sources.md`

