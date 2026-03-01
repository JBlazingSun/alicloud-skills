# CLI 防幻觉与结果可验证化方案（含业界参考）

本文档给出 `alicloud-skills` CLI 的防幻觉整体方案，目标是让 Agent 输出从“看起来完成”变成“可证明完成”。

适用代码范围：

- `apps/cmd/alicloud-skills`
- `apps/internal/agent`
- `apps/pkg/clikit`

---

## 1. 背景与目标

当前 CLI 已具备较强自治能力（`--autonomy` / `--auto`），但在真实执行中仍会出现以下风险：

1. 模型声称“已生成文件”，但文件不存在或格式错误。
2. 模型返回 `.json` 路径，但内容不是合法 JSON。
3. 模型在模糊任务下反问，导致任务未闭环。
4. 输出与系统可消费结果不一致（例如路径、类型、结构不稳定）。

### 目标

1. **真实性**：最终输出必须与文件系统真实状态一致。
2. **结构化**：关键结果必须以机器可校验结构返回。
3. **可恢复**：校验失败时自动重试/降级，而不是直接“假成功”。
4. **可观测**：可量化评估幻觉率、校验失败率、自动恢复成功率。

---

## 2. 设计原则（通用且可迁移）

1. **Contract First（先定义结果契约）**
   - 对可交付物（文件、JSON、摘要）定义最小契约。
2. **Deterministic Gate（确定性闸门）**
   - 最终结果必须经过本地程序校验，不通过即失败。
3. **Retry with Evidence（带证据重试）**
   - 重试需基于失败原因（缺文件/JSON 非法/类型错误）定向修复。
4. **Separation of Concern（关注点分离）**
   - 模型负责“生成候选结果”，程序负责“判真伪”。
5. **Measure What Matters（以结果指标治理）**
   - 用 SLO/SLA 风格指标持续优化，而不是依赖主观感受。

---

## 3. 当前仓库已落地能力（基线）

### 3.1 自治控制

- `--autonomy=conservative|balanced|aggressive`
- `--auto`（零提问 + aggressive + 自主执行系统约束）

### 3.2 已上线的结果校验（第一层）

已在 `clikit` 中实现：

1. 自动抽取输出中的 `output/...` 路径。
2. 校验文件存在。
3. 若后缀为 `.json`，执行 JSON 合法性校验。
4. 失败即返回错误，不再报告成功。

说明：这是“防幻觉闭环”最关键的一层，但仍需扩展到更多文件类型与结构化返回。

---

## 4. 分层防幻觉架构（建议最终形态）

```text
用户请求
  -> Prompt/Policy 层（是否零提问、是否允许澄清）
  -> Tool 执行层（Agent 调工具）
  -> 结果抽取层（路径/结构化输出）
  -> 结果校验层（存在性/格式/语义校验）
  -> 自动恢复层（重试/降级/回滚）
  -> 最终响应层（仅返回通过校验的结果）
```

### 4.1 Prompt/Policy 层

- `--auto`：禁止澄清提问、默认推断、直接执行。
- `--autonomy`：控制审批策略与权限边界。

### 4.2 结果抽取层

- 从 tool 输出和 LLM 输出提取候选 artifact：
  - 文件路径
  - URL
  - 结构化 JSON 块

### 4.3 结果校验层（建议扩展）

按文件类型执行不同校验器：

1. `*.json`
   - `json.Valid` + 可选 JSON Schema 校验。
2. 图片（`png/jpg/webp`）
   - 文件存在 + 可解码 + 尺寸满足约束（如 1024x1024）。
3. 文本产物（`md/txt`）
   - 非空 + 最小长度 + 编码合法。
4. 通用
   - 路径位于允许目录（例如 `output/`）。

### 4.4 自动恢复层

- 重试最多 `N` 次（建议 1-2 次）：
  - 第 1 次：原任务重试并携带失败原因。
  - 第 2 次：降级参数（例如固定尺寸/更简化提示词）。
- 若仍失败：输出机器可读错误原因，不报告成功。

---

## 5. 结果契约（建议标准）

建议引入统一响应契约（可作为 CLI 内部对象）：

```json
{
  "status": "success|failed",
  "artifacts": [
    {
      "path": "output/...",
      "type": "image|json|text",
      "checks": {
        "exists": true,
        "format_valid": true,
        "schema_valid": true
      }
    }
  ],
  "errors": []
}
```

规则：

- 只有当 `status=success` 且 `checks` 全通过时，才向用户展示“已完成”。
- 否则统一进入失败分支并触发重试。

---

## 6. 仓库落地路线图

### 阶段 A（已完成）

1. 自主模式与 `--auto`。
2. 路径存在性 + JSON 合法性校验。

### 阶段 B（建议优先）

1. 增加图片校验器（可解码 + 尺寸）。
2. 增加“校验失败自动重试”机制。
3. 输出统一错误码：
   - `ERR_ARTIFACT_NOT_FOUND`
   - `ERR_INVALID_JSON`
   - `ERR_INVALID_IMAGE`

### 阶段 C（结构化升级）

1. 引入 Structured Output（JSON Schema）作为最终响应格式。
2. 将 artifact 校验结果写入结构化对象。
3. 对外只暴露契约化结果。

### 阶段 D（治理与运营）

1. 增加指标与看板（见第 7 节）。
2. 用错误预算治理模型质量与发布节奏。
3. 建立回归集（高频任务 + 对抗提示词）。

---

## 7. 指标与 SLO（强烈建议）

### 7.1 核心指标

1. `artifact_verification_failure_rate`
   - 校验失败任务数 / 总任务数。
2. `json_invalid_rate`
   - `.json` 非法次数 / JSON 产物总数。
3. `retry_recovery_success_rate`
   - 进入重试后最终成功的比例。
4. `false_success_rate`
   - 用户侧发现失败但系统报告成功的比例（目标接近 0）。

### 7.2 SLO 示例

- `false_success_rate < 0.1%`
- `artifact_verification_failure_rate < 2%`
- `retry_recovery_success_rate > 60%`

---

## 8. 测试策略

### 8.1 单元测试

- 路径提取器：多路径、重复路径、带标点路径。
- JSON 校验器：合法/非法/空文件/缺文件。
- 图片校验器（后续）：存在但非图片、尺寸不匹配。

### 8.2 集成测试

- `--auto` 生成图片任务：必须产出真实文件。
- `--auto` 生成 JSON 任务：必须可解析。
- 故障注入：手工删除产物，确认系统返回失败而非成功。

### 8.3 回归测试集

- 建议维护 `apps/tests/cli/` 下固定样例，覆盖：
  - 模糊提示词
  - 高并发执行
  - 边界文件路径

---

## 9. 安全与风险控制

1. `aggressive/--auto` 仅用于受控环境。
2. 保留高危命令 denylist（如 `rm -rf /`）。
3. 对 `file_write` 限制目录边界。
4. 重要任务要求二次校验（人工或外部系统）。

---

## 10. 与业界方案映射（参考资料）

以下资料用于支撑本方案中的关键设计：

1. OpenAI Structured Outputs（结构化输出与 schema 约束）
   - https://platform.openai.com/docs/guides/structured-outputs/supported-schemas
   - https://openai.com/index/introducing-structured-outputs-in-the-api/

2. JSON 标准与 Schema 标准（格式合法性基础）
   - RFC 8259（JSON 标准）：https://www.rfc-editor.org/rfc/rfc8259
   - JSON Schema Draft 2020-12：https://json-schema.org/draft/2020-12

3. OWASP LLM Top 10（输出处理与过度自治风险）
   - https://owasp.org/www-project-top-10-for-large-language-model-applications/

4. NIST AI RMF（风险治理框架）
   - https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10

5. Google SRE（SLO/Error Budget 思路）
   - https://sre.google/workbook/implementing-slos/
   - https://sre.google/workbook/error-budget-policy/

6. Anthropic Tool Use（工具定义与澄清策略实践）
   - https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use

---

## 11. 推荐的下一步实施顺序（本仓库）

1. 在 `clikit` 增加图片解码与尺寸校验。
2. 在 `RunStream` 增加“校验失败自动重试一次”。
3. 引入统一错误码与结构化结果对象。
4. 把关键指标接入日志/追踪系统并形成周报。

