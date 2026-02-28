package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/godeps/agentkit/pkg/api"
	"github.com/godeps/agentkit/pkg/config"
	coreevents "github.com/godeps/agentkit/pkg/core/events"
	"github.com/godeps/agentkit/pkg/model"
	runtimeskills "github.com/godeps/agentkit/pkg/runtime/skills"
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
	RepoRoot        string
	ConfigRoot      string
	SkillsDirs      []string
	SkillsRecursive *bool
	ModelName       string
	APIKey          string
}

type Engine struct {
	runtime         *api.Runtime
	modelName       string
	settingsRoot    string
	skillsDirs      []string
	skillsRecursive bool
	metas           []SkillMeta
	mu              sync.RWMutex
	perm            PermissionHandler
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

	settingsRoot := strings.TrimSpace(cfg.ConfigRoot)
	if settingsRoot == "" {
		settingsRoot = resolveSettingsRoot()
	}
	metas, diagErrs := DiscoverSkills(cfg.RepoRoot, settingsRoot, cfg.SkillsDirs, cfg.SkillsRecursive)
	if len(metas) == 0 {
		return nil, fmt.Errorf("no skills found in %s", strings.Join(cfg.SkillsDirs, ", "))
	}
	for _, d := range diagErrs {
		log.Printf("skill discovery warning: %v", d)
	}
	runtimeOverrides := buildRuntimeOverrides(settingsRoot)

	var eng *Engine
	rt, err := api.New(ctx, api.Options{
		EntryPoint:          api.EntryPointCLI,
		ProjectRoot:         cfg.RepoRoot,
		ConfigRoot:          settingsRoot,
		ModelFactory:        &model.OpenAIProvider{APIKey: cfg.APIKey, BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", ModelName: cfg.ModelName},
		SystemPrompt:        BuildSystemPrompt(DefaultSystemPrompt, metas),
		SettingsOverrides:   runtimeOverrides,
		SkillsDirs:          cfg.SkillsDirs,
		SkillsRecursive:     cfg.SkillsRecursive,
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

	eng = &Engine{
		runtime:         rt,
		modelName:       cfg.ModelName,
		settingsRoot:    settingsRoot,
		skillsDirs:      normalizedSkillsDirs(cfg.RepoRoot, cfg.SkillsDirs),
		skillsRecursive: cfg.SkillsRecursive == nil || *cfg.SkillsRecursive,
		metas:           metas,
	}
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

func (e *Engine) SettingsRoot() string {
	if e == nil {
		return ""
	}
	return e.settingsRoot
}

func (e *Engine) SkillsDirs() []string {
	if e == nil {
		return nil
	}
	out := make([]string, len(e.skillsDirs))
	copy(out, e.skillsDirs)
	return out
}

func (e *Engine) SkillsRecursive() bool {
	if e == nil {
		return true
	}
	return e.skillsRecursive
}

func (e *Engine) EnrichPrompt(prompt string) string {
	if e == nil {
		return prompt
	}
	if name := MatchSkill(prompt, e.metas); name != "" {
		for _, m := range e.metas {
			if m.Name == name {
				path := m.SkillPath
				if strings.TrimSpace(path) == "" {
					path = filepath.Join(m.SkillDir, m.Name, "SKILL.md")
				}
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

func DiscoverSkills(projectRoot, configRoot string, skillsDirs []string, recursive *bool) ([]SkillMeta, []error) {
	var metas []SkillMeta
	regs, errs := runtimeskills.LoadFromFS(runtimeskills.LoaderOptions{
		ProjectRoot: projectRoot,
		ConfigRoot:  configRoot,
		Directories: skillsDirs,
		Recursive:   recursive,
	})
	for _, reg := range regs {
		source, _ := reg.Definition.Metadata["source"]
		meta := SkillMeta{
			Name:        reg.Definition.Name,
			Description: reg.Definition.Description,
			SkillPath:   source,
		}
		if strings.TrimSpace(source) != "" {
			meta.SkillDir = filepath.Dir(filepath.Dir(source))
		}
		metas = append(metas, meta)
	}
	return metas, errs
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

func normalizedSkillsDirs(projectRoot string, dirs []string) []string {
	seen := map[string]struct{}{}
	var out []string
	add := func(dir string) {
		dir = strings.TrimSpace(dir)
		if dir == "" {
			return
		}
		if !filepath.IsAbs(dir) && strings.TrimSpace(projectRoot) != "" {
			dir = filepath.Join(projectRoot, dir)
		}
		dir = filepath.Clean(dir)
		if _, ok := seen[dir]; ok {
			return
		}
		seen[dir] = struct{}{}
		out = append(out, dir)
	}
	for _, dir := range dirs {
		add(dir)
	}
	return out
}
