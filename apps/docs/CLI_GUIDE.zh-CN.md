# Alibaba Cloud Skills CLI 完整使用手册

本文档面向 `apps/cmd/alicloud-skills` 命令行工具，覆盖从启动到高级自动化的完整用法。

## 1. 适用范围

- 可执行程序：`alicloud-skills`
- 入口源码：`apps/cmd/alicloud-skills/main.go`
- 运行内核：`apps/internal/agent`
- CLI 通用封装：`apps/pkg/clikit`

## 2. 前置条件

1. Go 环境可用（建议与仓库 `apps/go.mod` 保持一致版本）。
2. 已配置 DashScope Key：

```bash
export DASHSCOPE_API_KEY="<your_key>"
```

3. 在仓库根目录执行命令。

## 3. 启动方式

### 3.1 直接运行源码

```bash
go -C apps run ./cmd/alicloud-skills --help
```

### 3.2 编译后运行

```bash
go -C apps build ./cmd/alicloud-skills
./apps/alicloud-skills --help
```

## 4. 命令总览

```text
alicloud-skills [flags]
alicloud-skills [command]
```

可用子命令：

- `run`：单次非交互执行
- `repl`：交互模式
- `skills`：列出已加载技能
- `config`：打印生效配置
- `api`：占位提示

## 5. 全局参数说明

- `--model string`
  - 模型名
  - 环境变量回退：`ALICLOUD_SKILLS_MODEL`

- `--config-root string`
  - 配置根目录（读取 `settings.json/settings.local.json`）
  - 环境变量回退：`ALICLOUD_SKILLS_SETTINGS_ROOT`

- `--skills-dir strings`
  - 追加技能目录（可重复）

- `--skills-recursive`
  - 是否递归发现 `SKILL.md`
  - 环境变量回退：`ALICLOUD_SKILLS_SKILLS_RECURSIVE`

- `--timeout-ms int`
  - 请求超时（毫秒）
  - 环境变量回退：`ALICLOUD_SKILLS_TIMEOUT_MS`

- `--session-id string`
  - 会话 ID；不传则自动生成

- `--print-effective-config`
  - 打印 CLI 与运行时生效配置

- `--verbose`
  - 输出更详细的流式诊断信息

- `--waterfall string`
  - 瀑布流输出模式：`off|summary|full`

- `-e, --execute string`
  - 一次性执行提示词并退出

- `--autonomy string`
  - 自主模式：`conservative|balanced|aggressive`

- `--auto`
  - 零提问全自主模式（强制 aggressive，并注入“禁止澄清”系统约束）

## 6. 三种执行模式

### 6.1 单次执行（推荐自动化）

```bash
go -C apps run ./cmd/alicloud-skills run "帮我总结当前目录关键文件"
```

或：

```bash
go -C apps run ./cmd/alicloud-skills -e "帮我总结当前目录关键文件"
```

### 6.2 交互执行（REPL）

```bash
go -C apps run ./cmd/alicloud-skills repl
```

内置命令：

- `/skills`
- `/new`
- `/session`
- `/model`
- `/help`
- `/quit`

### 6.3 配置/技能检查

```bash
go -C apps run ./cmd/alicloud-skills skills
go -C apps run ./cmd/alicloud-skills config
```

## 7. 自主模式详解

### 7.1 `conservative`

- 倾向人工确认
- 风险最低
- 自动化最低

### 7.2 `balanced`（默认）

- 常见低风险操作自动放行
- 对明显危险命令自动拒绝
- 自动化与安全平衡

### 7.3 `aggressive`

- 最大化自动执行
- 仍会拒绝明显高危操作
- 适合批量或无人值守流程

### 7.4 `--auto`（零提问）

`--auto` 用于“尽量不打断用户”的场景：

- 强制自主级别为 `aggressive`
- 系统提示会要求：不提澄清问题、默认推断参数、直接执行到可交付结果

示例：

```bash
go -C apps run ./cmd/alicloud-skills --auto -e "生成一张图片并保存到 output 目录"
```

## 8. 常用命令模板

### 8.1 生成图片（高自主）

```bash
go -C apps run ./cmd/alicloud-skills --auto -e "生成一张 1024x1024 的赛博城市夜景海报，保存到 output 目录并返回路径"
```

### 8.2 仅列技能（JSON）

```bash
go -C apps run ./cmd/alicloud-skills skills --json
```

### 8.3 打印配置

```bash
go -C apps run ./cmd/alicloud-skills config --print-effective-config
```

### 8.4 固定会话连续执行

```bash
SID="demo-session-001"
go -C apps run ./cmd/alicloud-skills --session-id "$SID" -e "先生成一张猫的图片"
go -C apps run ./cmd/alicloud-skills --session-id "$SID" -e "再生成同风格狗的图片"
```

## 9. 环境变量速查

- `DASHSCOPE_API_KEY`
- `ALICLOUD_SKILLS_MODEL`
- `ALICLOUD_SKILLS_SETTINGS_ROOT`
- `ALICLOUD_SKILLS_TIMEOUT_MS`
- `ALICLOUD_SKILLS_SKILLS_RECURSIVE`
- `ALICLOUD_SKILLS_AUTONOMY`
- `NO_COLOR`
- `CLICOLOR_FORCE`

## 10. 故障排查

### 10.1 报错 `DASHSCOPE_API_KEY is not set`

原因：未设置 API Key。

处理：

```bash
export DASHSCOPE_API_KEY="<your_key>"
```

### 10.2 REPL 输入退格异常/删除不稳定

当前版本已改为 `readline`。若仍异常：

```bash
stty -a | grep -E "erase|iutf8"
stty erase '^?'
stty iutf8
```

### 10.3 只返回了路径但文件不对

建议执行：

```bash
ls -lh <path>
file <path>
```

如果不是图片/目标类型，可提高提示词约束，或使用 `--auto` 并在提示词中明确输出格式与尺寸。

### 10.4 启动时出现 skill discovery warning

多为技能目录命名与 `SKILL.md` 内 `name` 不一致，通常不影响主流程；需在技能仓库层修复命名。

## 11. 安全建议

1. 生产环境默认用 `balanced`。
2. `aggressive/--auto` 仅用于受控环境。
3. 在关键任务中加入结果校验（文件类型、尺寸、是否存在）。
4. 对高风险操作建议加外层沙箱（容器/最小权限账号）。

## 12. 与 Makefile 配合

从仓库根目录可使用：

```bash
make run RUN_ARGS='run "你好"'
```

也可：

```bash
make run RUN_ARGS='--auto -e "生成一张图片"'
```

## 13. 最佳实践总结

1. 日常开发：`--autonomy balanced`
2. 无人值守批处理：`--auto`
3. 高风险操作：`--autonomy conservative`
4. 出问题先看：`config --print-effective-config` + `--verbose`

