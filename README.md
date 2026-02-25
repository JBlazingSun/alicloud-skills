# Alibaba Cloud Core AI Agent Skills

English (current) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md)

A curated collection of **Alibaba Cloud core AI Agent skills** covering key product lines,
including Model Studio, OSS, ECS, and more.

## Quick Start

Recommended install (all skills, skip prompts, overwrite existing):

```bash
npx skillfish add cinience/alicloud-skills --all -y --force
```

If you still see a selection prompt, press `a` to select all, then press Enter to submit.

Use a RAM user/role with least privilege. Avoid embedding AKs in code or CLI arguments.

Configure AccessKey (recommended):

```bash
export ALICLOUD_ACCESS_KEY_ID="your-ak"
export ALICLOUD_ACCESS_KEY_SECRET="your-sk"
export ALICLOUD_SECURITY_TOKEN="your-sts-token" # optional, for STS
export ALICLOUD_REGION_ID="cn-beijing"
export DASHSCOPE_API_KEY="your-dashscope-api-key"
```

Environment variables take precedence. If they are not set, the CLI/SDK falls back to `~/.alibabacloud/credentials`. `ALICLOUD_REGION_ID` is an optional default region; if unset, choose the most reasonable region at execution time, and ask the user when ambiguous.

If env vars are not set, use standard CLI/SDK config files:

`~/.alibabacloud/credentials`

```ini
[default]
type = access_key
access_key_id = your-ak
access_key_secret = your-sk
dashscope_api_key = your-dashscope-api-key
```

For STS, set `type = sts` and add `security_token = your-sts-token`.

## Examples (Docs Review & Benchmark)

1) Product docs + API docs review

- Prompt:
  "Use `alicloud-platform-docs-api-review` to review product docs and API docs for `Bailian`, then return prioritized P0/P1/P2 improvements with evidence links."

2) Multi-cloud comparable benchmark

- Prompt:
  "Use `alicloud-platform-multicloud-docs-api-benchmark` to benchmark `Bailian` against Alibaba Cloud/AWS/Azure/GCP/Tencent Cloud/Volcano Engine/Huawei Cloud with preset `llm-platform`, and output a score table plus gap actions."


## Repository Structure

- `skills/` — canonical skill sources grouped by product line
  - `ai/` — Model Studio (capability-based groups)
    - `text/` `image/` `audio/` `video/` `multimodal/` `search/` `misc/` `entry/`
  - `storage/` — OSS
  - `compute/` — ECS
  - `media/` — intelligent media creation
  - `network/` — VPC / SLB / EIP
  - `database/` — RDS / PolarDB / Redis
  - `security/` — RAM / KMS / WAF
  - `observability/` — SLS / ARMS / CloudMonitor
- `examples/` — end-to-end stories and usage walkthroughs

## Brand Aliases

- `modelstudio/` — symlink to `skills/ai/` (overseas brand)

## Skill Index

<!-- SKILL_INDEX_BEGIN -->
| 分类 | 技能 | 技能描述 | 路径 |
| --- | --- | --- | --- |
| ai/audio | alicloud-ai-audio-tts | 使用 Model Studio DashScope Qwen TTS 模型生成人声语音，适用于文本转语音与配音场景。 | `skills/ai/audio/alicloud-ai-audio-tts` |
| ai/audio | alicloud-ai-audio-tts-realtime | 使用 Alibaba Cloud Model Studio Qwen TTS Realtime 模型进行实时语音合成。 | `skills/ai/audio/alicloud-ai-audio-tts-realtime` |
| ai/audio | alicloud-ai-audio-tts-voice-clone | 使用 Alibaba Cloud Model Studio Qwen TTS VC 模型执行声音克隆流程。 | `skills/ai/audio/alicloud-ai-audio-tts-voice-clone` |
| ai/audio | alicloud-ai-audio-tts-voice-design | 使用 Alibaba Cloud Model Studio Qwen TTS VD 模型执行声音设计流程。 | `skills/ai/audio/alicloud-ai-audio-tts-voice-design` |
| ai/content | alicloud-ai-content-aicontent | 通过 OpenAPI/SDK 管理 Alibaba Cloud AIContent (AiContent)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/ai/content/alicloud-ai-content-aicontent` |
| ai/content | alicloud-ai-content-aimiaobi | 通过 OpenAPI/SDK 管理 Alibaba Cloud Quan Miao (AiMiaoBi)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/ai/content/alicloud-ai-content-aimiaobi` |
| ai/entry | alicloud-ai-entry-modelstudio | 将 Alibaba Cloud Model Studio 请求路由到最合适的本地技能（图像、视频、TTS 等）。 | `skills/ai/entry/alicloud-ai-entry-modelstudio` |
| ai/entry | alicloud-ai-entry-modelstudio-test | 为仓库中的 Model Studio 技能执行最小化测试矩阵并记录结果。 | `skills/ai/entry/alicloud-ai-entry-modelstudio-test` |
| ai/image | alicloud-ai-image-qwen-image | 通过 Model Studio DashScope SDK 进行图像生成，覆盖 prompt、size、seed 等核心参数。 | `skills/ai/image/alicloud-ai-image-qwen-image` |
| ai/image | alicloud-ai-image-qwen-image-edit | 技能 `alicloud-ai-image-qwen-image-edit` 的能力说明，详见对应 SKILL.md。 | `skills/ai/image/alicloud-ai-image-qwen-image-edit` |
| ai/image | alicloud-ai-image-zimage-turbo | 技能 `alicloud-ai-image-zimage-turbo` 的能力说明，详见对应 SKILL.md。 | `skills/ai/image/alicloud-ai-image-zimage-turbo` |
| ai/misc | alicloud-ai-misc-crawl-and-skill | 刷新 Model Studio 模型抓取结果并重新生成派生摘要及相关技能内容。 | `skills/ai/misc/alicloud-ai-misc-crawl-and-skill` |
| ai/multimodal | alicloud-ai-multimodal-qwen-vl | 技能 `alicloud-ai-multimodal-qwen-vl` 的能力说明，详见对应 SKILL.md。 | `skills/ai/multimodal/alicloud-ai-multimodal-qwen-vl` |
| ai/platform | alicloud-ai-pai-aiworkspace | 通过 OpenAPI/SDK 管理 Alibaba Cloud Platform for Artificial Intelligence PAI - AIWorkspace (AIWorkSpace)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/ai/platform/alicloud-ai-pai-aiworkspace` |
| ai/recommendation | alicloud-ai-recommend-airec | 通过 OpenAPI/SDK 管理 Alibaba Cloud AIRec (Airec)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/ai/recommendation/alicloud-ai-recommend-airec` |
| ai/search | alicloud-ai-search-dashvector | 使用 Python SDK 构建 DashVector 向量检索能力，支持集合创建、写入与相似度查询。 | `skills/ai/search/alicloud-ai-search-dashvector` |
| ai/search | alicloud-ai-search-milvus | 使用 PyMilvus 对接 AliCloud Milvus（Serverless），用于向量写入与相似度检索。 | `skills/ai/search/alicloud-ai-search-milvus` |
| ai/search | alicloud-ai-search-opensearch | 通过 Python SDK（ha3engine）使用 OpenSearch 向量检索版，支持文档写入与检索。 | `skills/ai/search/alicloud-ai-search-opensearch` |
| ai/service | alicloud-ai-chatbot | 通过 OpenAPI/SDK 管理 Alibaba Cloud beebot (Chatbot)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/ai/service/alicloud-ai-chatbot` |
| ai/service | alicloud-ai-cloud-call-center | 通过 OpenAPI/SDK 管理 Alibaba Cloud Cloud Call Center (CCC)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/ai/service/alicloud-ai-cloud-call-center` |
| ai/service | alicloud-ai-contactcenter-ai | 通过 OpenAPI/SDK 管理 Alibaba Cloud Contact Center AI (ContactCenterAI)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/ai/service/alicloud-ai-contactcenter-ai` |
| ai/text | alicloud-ai-text-document-mind | 通过 Node.js SDK 使用 Document Mind（DocMind）执行文档解析任务并轮询结果。 | `skills/ai/text/alicloud-ai-text-document-mind` |
| ai/translation | alicloud-ai-translation-anytrans | 通过 OpenAPI/SDK 管理 Alibaba Cloud TongyiTranslate (AnyTrans)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/ai/translation/alicloud-ai-translation-anytrans` |
| ai/video | alicloud-ai-video-wan-r2v | 技能 `alicloud-ai-video-wan-r2v` 的能力说明，详见对应 SKILL.md。 | `skills/ai/video/alicloud-ai-video-wan-r2v` |
| ai/video | alicloud-ai-video-wan-video | 通过 Model Studio DashScope SDK 进行视频生成，支持时长、帧率、尺寸等参数控制。 | `skills/ai/video/alicloud-ai-video-wan-video` |
| backup/alicloud-backup-bdrc | alicloud-backup-bdrc | 通过 OpenAPI/SDK 管理 Alibaba Cloud Backup and Disaster Recovery Center (BDRC)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/backup/alicloud-backup-bdrc` |
| backup/alicloud-backup-hbr | alicloud-backup-hbr | 通过 OpenAPI/SDK 管理 Alibaba Cloud Cloud Backup (hbr)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/backup/alicloud-backup-hbr` |
| compute/ecs | alicloud-compute-ecs | 技能 `alicloud-compute-ecs` 的能力说明，详见对应 SKILL.md。 | `skills/compute/ecs/alicloud-compute-ecs` |
| compute/fc | alicloud-compute-fc-agentrun | 通过 OpenAPI 管理 Function Compute AgentRun 资源，支持运行时、端点与状态查询。 | `skills/compute/fc/alicloud-compute-fc-agentrun` |
| compute/fc | alicloud-compute-fc-serverless-devs | 技能 `alicloud-compute-fc-serverless-devs` 的能力说明，详见对应 SKILL.md。 | `skills/compute/fc/alicloud-compute-fc-serverless-devs` |
| compute/swas | alicloud-compute-swas-open | 技能 `alicloud-compute-swas-open` 的能力说明，详见对应 SKILL.md。 | `skills/compute/swas/alicloud-compute-swas-open` |
| data-analytics/alicloud-data-analytics-dataanalysisgbi | alicloud-data-analytics-dataanalysisgbi | 通过 OpenAPI/SDK 管理 Alibaba Cloud DataAnalysisGBI (DataAnalysisGBI)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/data-analytics/alicloud-data-analytics-dataanalysisgbi` |
| data-lake/alicloud-data-lake-dlf | alicloud-data-lake-dlf | 通过 OpenAPI/SDK 管理 Alibaba Cloud Data Lake Formation (DataLake)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/data-lake/alicloud-data-lake-dlf` |
| data-lake/alicloud-data-lake-dlf-next | alicloud-data-lake-dlf-next | 通过 OpenAPI/SDK 管理 Alibaba Cloud Data Lake Formation (DlfNext)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/data-lake/alicloud-data-lake-dlf-next` |
| database/analyticdb | alicloud-database-analyticdb-mysql | 通过 OpenAPI/SDK 管理 Alibaba Cloud AnalyticDB for MySQL (adb)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/database/analyticdb/alicloud-database-analyticdb-mysql` |
| database/rds | alicloud-database-rds-supabase | 通过 OpenAPI 管理 Alibaba Cloud RDS Supabase，覆盖实例生命周期与关键配置操作。 | `skills/database/rds/alicloud-database-rds-supabase` |
| media/video | alicloud-media-video-translation | 通过 OpenAPI 创建和管理 Alibaba Cloud IMS 视频翻译任务，支持字幕、语音与人脸相关配置。 | `skills/media/video/alicloud-media-video-translation` |
| network/dns | alicloud-network-dns-cli | Alibaba Cloud DNS（Alidns）CLI 技能。 | `skills/network/dns/alicloud-network-dns-cli` |
| observability/sls | alicloud-observability-sls-log-query | 技能 `alicloud-observability-sls-log-query` 的能力说明，详见对应 SKILL.md。 | `skills/observability/sls/alicloud-observability-sls-log-query` |
| platform/docs | alicloud-platform-docs-api-review | 自动评审最新 Alibaba Cloud 产品文档与 OpenAPI 文档，并输出优先级建议与证据。 | `skills/platform/docs/alicloud-platform-docs-api-review` |
| platform/docs | alicloud-platform-multicloud-docs-api-benchmark | 对阿里云及主流云厂商同类产品文档与 API 文档进行基准对比并给出改进建议。 | `skills/platform/docs/alicloud-platform-multicloud-docs-api-benchmark` |
| platform/openapi | alicloud-platform-openapi-product-api-discovery | 发现并对齐 Alibaba Cloud 产品目录与 OpenAPI 元数据，用于覆盖分析和技能规划。 | `skills/platform/openapi/alicloud-platform-openapi-product-api-discovery` |
| security/content | alicloud-security-content-moderation-green | 通过 OpenAPI/SDK 管理 Alibaba Cloud Content Moderation (Green)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/security/content/alicloud-security-content-moderation-green` |
| security/firewall | alicloud-security-cloudfw | 通过 OpenAPI/SDK 管理 Alibaba Cloud Cloud Firewall (Cloudfw)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/security/firewall/alicloud-security-cloudfw` |
| security/host | alicloud-security-center-sas | 通过 OpenAPI/SDK 管理 Alibaba Cloud Security Center (Sas)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/security/host/alicloud-security-center-sas` |
| security/identity | alicloud-security-id-verification-cloudauth | 通过 OpenAPI/SDK 管理 Alibaba Cloud ID Verification (Cloudauth)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/security/identity/alicloud-security-id-verification-cloudauth` |
| security/key-management | alicloud-security-kms | 通过 OpenAPI/SDK 管理 Alibaba Cloud KeyManagementService (Kms)，用于资源查询、创建或更新配置、状态查询与故障排查。 | `skills/security/key-management/alicloud-security-kms` |
| storage/oss | alicloud-storage-oss-ossutil | Alibaba Cloud OSS CLI（ossutil 2.0）技能，支持命令行安装、配置与 OSS 资源操作。 | `skills/storage/oss/alicloud-storage-oss-ossutil` |
<!-- SKILL_INDEX_END -->

Update the index by running: `scripts/update_skill_index.sh`

## Industry Use Cases

See: `examples/industry-use-cases.md`

## Notes

- This repository focuses on Alibaba Cloud's core capabilities and their Claude skill implementations.
- More skills can be added under `skills/` as they become available.

## Output Policy

- All temporary files and generated artifacts must be written under `output/`.
- Use subfolders per skill, e.g. `output/<skill>/...`.
- `output/` is ignored by git and should not be committed.
