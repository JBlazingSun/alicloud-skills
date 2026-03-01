package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/cinience/alicloud-skills/internal/agent"
	"github.com/cinience/alicloud-skills/pkg/clikit"
	"github.com/godeps/agentkit/pkg/api"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/spf13/cobra"
)

const (
	waterfallModeFull = clikit.WaterfallModeFull
)

type cliEngineAdapter struct {
	eng *agent.Engine
}

func (a *cliEngineAdapter) ModelName() string { return a.eng.ModelName() }

func (a *cliEngineAdapter) SettingsRoot() string { return a.eng.SettingsRoot() }

func (a *cliEngineAdapter) SkillsRecursive() bool { return a.eng.SkillsRecursive() }

func (a *cliEngineAdapter) SkillsDirs() []string { return a.eng.SkillsDirs() }
func (a *cliEngineAdapter) RepoRoot() string     { return a.eng.RepoRoot() }

func (a *cliEngineAdapter) Skills() []clikit.SkillMeta {
	src := a.eng.Skills()
	out := make([]clikit.SkillMeta, 0, len(src))
	for _, s := range src {
		out = append(out, clikit.SkillMeta{Name: s.Name})
	}
	return out
}

func (a *cliEngineAdapter) RunStream(ctx context.Context, sessionID, prompt string) (<-chan api.StreamEvent, error) {
	return a.eng.RunStream(ctx, sessionID, prompt)
}

func (a *cliEngineAdapter) ModelTurnCount(sessionID string) int {
	return a.eng.ModelTurnCount(sessionID)
}

func (a *cliEngineAdapter) ModelTurnsSince(sessionID string, offset int) []clikit.ModelTurnStat {
	src := a.eng.ModelTurnsSince(sessionID, offset)
	out := make([]clikit.ModelTurnStat, 0, len(src))
	for _, turn := range src {
		out = append(out, clikit.ModelTurnStat{
			Iteration:    turn.Iteration,
			InputTokens:  turn.InputTokens,
			OutputTokens: turn.OutputTokens,
			TotalTokens:  turn.TotalTokens,
			StopReason:   turn.StopReason,
			Preview:      turn.Preview,
			Timestamp:    turn.Timestamp,
		})
	}
	return out
}

func toCLIAppConfig(cfg agent.Config) clikit.EffectiveConfig {
	return clikit.EffectiveConfig{
		ModelName:       cfg.ModelName,
		ConfigRoot:      cfg.ConfigRoot,
		SkillsDirs:      cfg.SkillsDirs,
		SkillsRecursive: cfg.SkillsRecursive,
	}
}

func main() {
	_ = godotenv.Load()
	if err := newRootCmd().Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
}

type cliOptions struct {
	modelName       string
	configRoot      string
	skillsRecursive bool
	timeoutMs       int
	autonomy        string
	auto            bool
	sessionID       string
	printConfig     bool
	verbose         bool
	waterfall       string
	execute         string
	skillsDirs      []string
}

func newRootCmd() *cobra.Command {
	opts := &cliOptions{
		skillsRecursive: true,
		timeoutMs:       10 * 60 * 1000,
		autonomy:        agent.AutonomyBalanced,
		waterfall:       waterfallModeFull,
	}

	rootCmd := &cobra.Command{
		Use:   "alicloud-skills",
		Short: "Alibaba Cloud Agent CLI",
		Long:  "Alibaba Cloud skill-powered CLI for one-shot and interactive workflows.",
		RunE: func(cmd *cobra.Command, args []string) error {
			resolved := resolveCLIOptions(cmd, *opts)
			if strings.TrimSpace(resolved.execute) != "" {
				return runOneShot(cmd.Context(), resolved, resolved.execute)
			}
			return runInteractive(cmd.Context(), resolved)
		},
	}

	rootCmd.PersistentFlags().StringVar(&opts.modelName, "model", "", "Model name")
	rootCmd.PersistentFlags().StringVar(&opts.configRoot, "config-root", "", "Config root directory (settings.json/settings.local.json)")
	rootCmd.PersistentFlags().BoolVar(&opts.skillsRecursive, "skills-recursive", true, "Discover SKILL.md recursively")
	rootCmd.PersistentFlags().IntVar(&opts.timeoutMs, "timeout-ms", 10*60*1000, "Run timeout in milliseconds")
	rootCmd.PersistentFlags().StringVar(&opts.autonomy, "autonomy", agent.AutonomyBalanced, "Autonomy level: conservative|balanced|aggressive")
	rootCmd.PersistentFlags().BoolVar(&opts.auto, "auto", false, "Enable zero-question fully autonomous execution mode")
	rootCmd.PersistentFlags().StringVar(&opts.sessionID, "session-id", "", "Session ID (default: auto-generate)")
	rootCmd.PersistentFlags().BoolVar(&opts.printConfig, "print-effective-config", false, "Print resolved runtime config before running")
	rootCmd.PersistentFlags().BoolVar(&opts.verbose, "verbose", false, "Verbose stream diagnostics")
	rootCmd.PersistentFlags().StringVar(&opts.waterfall, "waterfall", waterfallModeFull, "Waterfall output mode: off|summary|full")
	if f := rootCmd.PersistentFlags().Lookup("waterfall"); f != nil {
		f.NoOptDefVal = waterfallModeFull
	}
	rootCmd.PersistentFlags().StringVarP(&opts.execute, "execute", "e", "", "Execute a single prompt and exit")
	rootCmd.PersistentFlags().StringSliceVar(&opts.skillsDirs, "skills-dir", nil, "Skills directory (repeatable)")

	rootCmd.AddCommand(newRunCmd(opts))
	rootCmd.AddCommand(newReplCmd(opts))
	rootCmd.AddCommand(newSkillsCmd(opts))
	rootCmd.AddCommand(newConfigCmd(opts))
	rootCmd.AddCommand(newAPICmd())

	return rootCmd
}

func newRunCmd(opts *cliOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "run [prompt...]",
		Short: "Run a single non-interactive prompt",
		RunE: func(cmd *cobra.Command, args []string) error {
			resolved := resolveCLIOptions(cmd, *opts)
			prompt := strings.TrimSpace(strings.Join(args, " "))
			withStdin, err := maybePrependStdin(prompt)
			if err != nil {
				return err
			}
			if strings.TrimSpace(withStdin) == "" {
				return fmt.Errorf("no prompt provided")
			}
			return runOneShot(cmd.Context(), resolved, withStdin)
		},
	}
}

func newReplCmd(opts *cliOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "repl",
		Short: "Run interactive REPL mode",
		RunE: func(cmd *cobra.Command, args []string) error {
			resolved := resolveCLIOptions(cmd, *opts)
			return runInteractive(cmd.Context(), resolved)
		},
	}
}

func newSkillsCmd(opts *cliOptions) *cobra.Command {
	var jsonOutput bool
	cmd := &cobra.Command{
		Use:   "skills",
		Short: "List loaded skills",
		RunE: func(cmd *cobra.Command, args []string) error {
			resolved := resolveCLIOptions(cmd, *opts)
			eng, repoRoot, cfg, err := initEngine(cmd.Context(), resolved)
			if err != nil {
				return err
			}
			defer eng.Close()
			if resolved.printConfig {
				adapter := &cliEngineAdapter{eng: eng}
				clikit.PrintEffectiveConfig(cmd.OutOrStdout(), repoRoot, toCLIAppConfig(cfg), resolved.timeoutMs)
				clikit.PrintRuntimeEffectiveConfig(cmd.OutOrStdout(), adapter, resolved.timeoutMs)
			}
			metas := eng.Skills()
			sort.Slice(metas, func(i, j int) bool { return metas[i].Name < metas[j].Name })
			if jsonOutput {
				return json.NewEncoder(cmd.OutOrStdout()).Encode(metas)
			}
			for _, m := range metas {
				fmt.Fprintf(cmd.OutOrStdout(), "- %s\n", m.Name)
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	return cmd
}

func newConfigCmd(opts *cliOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "config",
		Short: "Print effective CLI/runtime config",
		RunE: func(cmd *cobra.Command, args []string) error {
			resolved := resolveCLIOptions(cmd, *opts)
			eng, repoRoot, cfg, err := initEngine(cmd.Context(), resolved)
			if err != nil {
				return err
			}
			defer eng.Close()
			adapter := &cliEngineAdapter{eng: eng}
			clikit.PrintEffectiveConfig(cmd.OutOrStdout(), repoRoot, toCLIAppConfig(cfg), resolved.timeoutMs)
			clikit.PrintRuntimeEffectiveConfig(cmd.OutOrStdout(), adapter, resolved.timeoutMs)
			return nil
		},
	}
}

func newAPICmd() *cobra.Command {
	return &cobra.Command{
		Use:   "api",
		Short: "API mode placeholder",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Fprintln(cmd.OutOrStdout(), "A dedicated `api` subcommand is not implemented in this CLI.")
			fmt.Fprintln(cmd.OutOrStdout(), "Use one-shot mode instead:")
			fmt.Fprintln(cmd.OutOrStdout(), "  alicloud-skills run \"<prompt>\" [flags]")
			fmt.Fprintln(cmd.OutOrStdout(), "  alicloud-skills -e \"<prompt>\" [flags]")
			return nil
		},
	}
}

func resolveCLIOptions(cmd *cobra.Command, in cliOptions) cliOptions {
	out := in
	if strings.TrimSpace(out.modelName) == "" {
		out.modelName = strings.TrimSpace(os.Getenv("ALICLOUD_SKILLS_MODEL"))
	}
	if strings.TrimSpace(out.modelName) == "" {
		out.modelName = agent.DefaultModel
	}
	if strings.TrimSpace(out.configRoot) == "" {
		out.configRoot = strings.TrimSpace(os.Getenv("ALICLOUD_SKILLS_SETTINGS_ROOT"))
	}
	if !flagChanged(cmd, "timeout-ms") {
		if v := strings.TrimSpace(os.Getenv("ALICLOUD_SKILLS_TIMEOUT_MS")); v != "" {
			if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
				out.timeoutMs = parsed
			}
		}
	}
	if !flagChanged(cmd, "skills-recursive") {
		if v := strings.TrimSpace(os.Getenv("ALICLOUD_SKILLS_SKILLS_RECURSIVE")); v != "" {
			if parsed, err := strconv.ParseBool(v); err == nil {
				out.skillsRecursive = parsed
			}
		}
	}
	if !flagChanged(cmd, "autonomy") {
		if v := strings.TrimSpace(os.Getenv("ALICLOUD_SKILLS_AUTONOMY")); v != "" {
			out.autonomy = v
		}
	}
	if out.auto {
		out.autonomy = agent.AutonomyAggressive
	}
	out.autonomy = agent.NormalizeAutonomyMode(out.autonomy)
	out.waterfall = clikit.NormalizeWaterfallMode(out.waterfall)
	return out
}

func flagChanged(cmd *cobra.Command, name string) bool {
	if cmd == nil {
		return false
	}
	if f := cmd.Flags().Lookup(name); f != nil && f.Changed {
		return true
	}
	if f := cmd.InheritedFlags().Lookup(name); f != nil && f.Changed {
		return true
	}
	return false
}

func initEngine(ctx context.Context, opts cliOptions) (*agent.Engine, string, agent.Config, error) {
	repoRoot := agent.ResolveRepoRoot("")
	cfg := agent.Config{
		RepoRoot:        repoRoot,
		ConfigRoot:      strings.TrimSpace(opts.configRoot),
		ModelName:       opts.modelName,
		Autonomy:        opts.autonomy,
		ZeroQuestion:    opts.auto,
		SkillsRecursive: boolPtr(opts.skillsRecursive),
	}
	if len(opts.skillsDirs) > 0 {
		cfg.SkillsDirs = make([]string, 0, len(opts.skillsDirs))
		for _, d := range opts.skillsDirs {
			cfg.SkillsDirs = append(cfg.SkillsDirs, filepath.Clean(strings.TrimSpace(d)))
		}
	}
	if opts.printConfig {
		clikit.PrintEffectiveConfig(os.Stdout, repoRoot, toCLIAppConfig(cfg), opts.timeoutMs)
	}

	eng, err := agent.NewEngine(ctx, cfg)
	if err != nil {
		return nil, "", cfg, fmt.Errorf("init failed: %w", err)
	}
	return eng, repoRoot, cfg, nil
}

func runOneShot(ctx context.Context, opts cliOptions, prompt string) error {
	eng, _, _, err := initEngine(ctx, opts)
	if err != nil {
		return err
	}
	defer eng.Close()

	runSessionID := strings.TrimSpace(opts.sessionID)
	if runSessionID == "" {
		runSessionID = uuid.NewString()
	}
	adapter := &cliEngineAdapter{eng: eng}
	if err := clikit.RunStream(ctx, adapter, runSessionID, prompt, opts.timeoutMs, opts.verbose, opts.waterfall); err != nil {
		return fmt.Errorf("run failed: %w", err)
	}
	return nil
}

func runInteractive(ctx context.Context, opts cliOptions) error {
	eng, _, _, err := initEngine(ctx, opts)
	if err != nil {
		return err
	}
	defer eng.Close()

	adapter := &cliEngineAdapter{eng: eng}
	clikit.PrintBanner(eng.ModelName(), adapter.Skills())
	if opts.printConfig {
		clikit.PrintRuntimeEffectiveConfig(os.Stdout, adapter, opts.timeoutMs)
	}
	clikit.RunREPL(ctx, adapter, opts.timeoutMs, opts.verbose, opts.waterfall, opts.sessionID)
	return nil
}

func maybePrependStdin(prompt string) (string, error) {
	if fi, err := os.Stdin.Stat(); err == nil {
		if (fi.Mode()&os.ModeNamedPipe) == 0 && !fi.Mode().IsRegular() {
			return prompt, nil
		}
	} else {
		return prompt, err
	}
	b, err := io.ReadAll(os.Stdin)
	if err != nil {
		return prompt, err
	}
	stdinText := strings.TrimSpace(string(b))
	if stdinText == "" {
		return prompt, nil
	}
	if strings.TrimSpace(prompt) == "" {
		return stdinText, nil
	}
	return stdinText + "\n\n" + prompt, nil
}

func boolPtr(v bool) *bool { return &v }
