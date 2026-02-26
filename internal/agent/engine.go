package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/godeps/agentkit/pkg/api"
	"github.com/godeps/agentkit/pkg/config"
	coreevents "github.com/godeps/agentkit/pkg/core/events"
	"github.com/godeps/agentkit/pkg/model"
	"github.com/godeps/agentkit/pkg/prompts"
)

const DefaultModel = "qwen3.5-plus"

const DefaultSystemPrompt = `You are a skill-powered assistant for Alibaba Cloud tasks.

Rules:
- Prefer skills from this repository when they match the request.
- Read the target SKILL.md before executing scripts.
- Keep responses concise and practical.
- If a request is ambiguous, ask a short clarifying question.
- Respond in the same language as the user.`

type Config struct {
	RepoRoot   string
	SkillsDirs []string
	ModelName  string
	APIKey     string
}

type Engine struct {
	runtime   *api.Runtime
	modelName string
	metas     []SkillMeta
	mu        sync.RWMutex
	perm      PermissionHandler
}

type PermissionDecision string

const (
	PermissionAllow PermissionDecision = "allow"
	PermissionDeny  PermissionDecision = "deny"
	PermissionAsk   PermissionDecision = "ask"
)

type PermissionRequest struct {
	ToolName   string
	ToolParams map[string]any
	SessionID  string
	Rule       string
	Target     string
	Reason     string
}

type PermissionHandler func(context.Context, PermissionRequest) (PermissionDecision, error)

func NewEngine(ctx context.Context, cfg Config) (*Engine, error) {
	if cfg.RepoRoot == "" {
		cfg.RepoRoot = ResolveRepoRoot("")
	}
	if cfg.ModelName == "" {
		cfg.ModelName = DefaultModel
	}
	if len(cfg.SkillsDirs) == 0 {
		home, _ := os.UserHomeDir()
		cfg.SkillsDirs = ResolveDefaultSkillsDirs(cfg.RepoRoot, home)
	}
	if cfg.APIKey == "" {
		cfg.APIKey = os.Getenv("DASHSCOPE_API_KEY")
	}
	if cfg.APIKey == "" {
		return nil, errors.New("DASHSCOPE_API_KEY is not set")
	}

	regs, metas := DiscoverSkills(cfg.SkillsDirs)
	if len(metas) == 0 {
		return nil, fmt.Errorf("no skills found in %s", strings.Join(cfg.SkillsDirs, ", "))
	}
	settingsRoot := resolveSettingsRoot()
	runtimeOverrides := buildRuntimeOverrides(settingsRoot)
	bridgeRoot := ensureAgentkitBridgeRoot()

	var eng *Engine
	rt, err := api.New(ctx, api.Options{
		EntryPoint:          api.EntryPointCLI,
		ProjectRoot:         cfg.RepoRoot,
		SettingsLoader:      &config.SettingsLoader{ProjectRoot: bridgeRoot},
		ModelFactory:        &model.OpenAIProvider{APIKey: cfg.APIKey, BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", ModelName: cfg.ModelName},
		SystemPrompt:        BuildSystemPrompt(DefaultSystemPrompt, metas),
		SettingsOverrides:   runtimeOverrides,
		Skills:              regs,
		EnabledBuiltinTools: []string{"bash", "file_read", "file_write", "glob"},
		DefaultEnableCache:  true,
		TokenTracking:       true,
		ApprovalWait:        true,
		PermissionRequestHandler: func(ctx context.Context, req api.PermissionRequest) (coreevents.PermissionDecisionType, error) {
			if eng == nil {
				return coreevents.PermissionDeny, nil
			}
			return eng.handlePermissionRequest(ctx, req)
		},
	})
	if err != nil {
		return nil, err
	}

	eng = &Engine{runtime: rt, modelName: cfg.ModelName, metas: metas}
	return eng, nil
}

func (e *Engine) Close() error {
	if e == nil || e.runtime == nil {
		return nil
	}
	return e.runtime.Close()
}

func (e *Engine) ModelName() string {
	if e == nil {
		return ""
	}
	return e.modelName
}

func (e *Engine) Skills() []SkillMeta {
	if e == nil {
		return nil
	}
	out := make([]SkillMeta, len(e.metas))
	copy(out, e.metas)
	return out
}

func (e *Engine) EnrichPrompt(prompt string) string {
	if e == nil {
		return prompt
	}
	if name := MatchSkill(prompt, e.metas); name != "" {
		for _, m := range e.metas {
			if m.Name == name {
				path := filepath.Join(m.SkillDir, m.Name, "SKILL.md")
				if data, err := os.ReadFile(path); err == nil {
					return fmt.Sprintf("Skill instructions already loaded:\n\n<skill name=%q>\n%s\n</skill>\n\nUser request:\n%s", m.Name, strings.TrimSpace(string(data)), prompt)
				}
				break
			}
		}
	}
	return prompt
}

func (e *Engine) Run(ctx context.Context, sessionID, prompt string) (string, error) {
	if e == nil || e.runtime == nil {
		return "", errors.New("engine not initialized")
	}
	resp, err := e.runtime.Run(ctx, api.Request{Prompt: e.EnrichPrompt(prompt), SessionID: sessionID})
	if err != nil {
		return "", err
	}
	if resp == nil || resp.Result == nil {
		return "", nil
	}
	return strings.TrimSpace(resp.Result.Output), nil
}

func (e *Engine) RunStream(ctx context.Context, sessionID, prompt string) (<-chan api.StreamEvent, error) {
	if e == nil || e.runtime == nil {
		return nil, errors.New("engine not initialized")
	}
	return e.runtime.RunStream(ctx, api.Request{Prompt: e.EnrichPrompt(prompt), SessionID: sessionID})
}

func (e *Engine) SetPermissionHandler(fn PermissionHandler) {
	if e == nil {
		return
	}
	e.mu.Lock()
	e.perm = fn
	e.mu.Unlock()
}

func (e *Engine) handlePermissionRequest(ctx context.Context, req api.PermissionRequest) (coreevents.PermissionDecisionType, error) {
	e.mu.RLock()
	fn := e.perm
	e.mu.RUnlock()
	if fn == nil {
		return coreevents.PermissionDeny, nil
	}
	decision, err := fn(ctx, PermissionRequest{
		ToolName:   req.ToolName,
		ToolParams: req.ToolParams,
		SessionID:  req.SessionID,
		Rule:       req.Rule,
		Target:     req.Target,
		Reason:     req.Reason,
	})
	if err != nil {
		return coreevents.PermissionDeny, err
	}
	switch decision {
	case PermissionAllow:
		return coreevents.PermissionAllow, nil
	case PermissionAsk:
		return coreevents.PermissionAsk, nil
	default:
		return coreevents.PermissionDeny, nil
	}
}

func currentProcessEnvMap() map[string]string {
	raw := os.Environ()
	out := make(map[string]string, len(raw))
	for _, entry := range raw {
		key, val, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		out[key] = val
	}
	return out
}

func resolveSettingsRoot() string {
	if v := strings.TrimSpace(os.Getenv("ALICLOUD_SKILLS_SETTINGS_ROOT")); v != "" {
		return filepath.Clean(v)
	}
	return resolveBrandHome()
}

func resolveBrandHome() string {
	if v := strings.TrimSpace(os.Getenv("ALICLOUD_SKILLS_HOME")); v != "" {
		return filepath.Clean(v)
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return filepath.Clean(".alicloud-skills")
	}
	return filepath.Join(home, ".alicloud-skills")
}

func ensureFile(path string, content []byte) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	}
	return os.WriteFile(path, content, 0o644)
}

func ensureAgentkitBridgeRoot() string {
	bridgeRoot := filepath.Join(os.TempDir(), "alicloud-skills-agentkit-settings")
	claudeDir := filepath.Join(bridgeRoot, ".claude")
	_ = os.MkdirAll(claudeDir, 0o755)
	_ = ensureFile(filepath.Join(claudeDir, "settings.json"), []byte("{}\n"))
	_ = ensureFile(filepath.Join(claudeDir, "settings.local.json"), []byte("{}\n"))
	return bridgeRoot
}

func buildRuntimeOverrides(settingsRoot string) *config.Settings {
	merged := &config.Settings{}
	if cfg, err := loadSettingsJSON(filepath.Join(settingsRoot, "settings.json")); err == nil && cfg != nil {
		if next := config.MergeSettings(merged, cfg); next != nil {
			merged = next
		}
	}
	if cfg, err := loadSettingsJSON(filepath.Join(settingsRoot, "settings.local.json")); err == nil && cfg != nil {
		if next := config.MergeSettings(merged, cfg); next != nil {
			merged = next
		}
	}
	if merged.Env == nil {
		merged.Env = map[string]string{}
	}
	for k, v := range currentProcessEnvMap() {
		if _, exists := merged.Env[k]; exists {
			continue
		}
		merged.Env[k] = v
	}
	return merged
}

func loadSettingsJSON(path string) (*config.Settings, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var s config.Settings
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func DiscoverSkills(skillsDirs []string) ([]api.SkillRegistration, []SkillMeta) {
	var regs []api.SkillRegistration
	var metas []SkillMeta
	seen := map[string]string{}

	for _, dir := range skillsDirs {
		stat, err := os.Stat(dir)
		if err != nil || !stat.IsDir() {
			continue
		}

		abs, err := filepath.Abs(dir)
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(string(filepath.Separator), abs)
		if err != nil {
			continue
		}

		builtins := prompts.ParseWithOptions(os.DirFS(string(filepath.Separator)), prompts.ParseOptions{
			SkillsDir: filepath.ToSlash(rel),
		})

		for _, reg := range builtins.Skills {
			if prev, ok := seen[reg.Definition.Name]; ok {
				_ = prev
				continue
			}
			def := reg.Definition
			def.DisableAutoActivation = true
			regs = append(regs, api.SkillRegistration{Definition: def, Handler: reg.Handler})
			metas = append(metas, SkillMeta{Name: def.Name, Description: def.Description, SkillDir: dir})
			seen[def.Name] = dir
		}
	}

	return regs, metas
}

func ResolveRepoRoot(cwd string) string {
	var candidates []string
	if cwd != "" {
		candidates = append(candidates, cwd)
	}
	if wd, err := os.Getwd(); err == nil && wd != "" {
		candidates = append(candidates, wd)
	}
	if exe, err := os.Executable(); err == nil && exe != "" {
		candidates = append(candidates, filepath.Dir(exe))
	}

	for _, base := range candidates {
		base = filepath.Clean(base)
		for {
			if _, err := fs.Stat(os.DirFS(base), "skills"); err == nil {
				return base
			}
			parent := filepath.Dir(base)
			if parent == base {
				break
			}
			base = parent
		}
	}

	if len(candidates) > 0 {
		return filepath.Clean(candidates[0])
	}
	return "."
}
