package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/cinience/alicloud-skills/internal/agent"
	"github.com/godeps/agentkit/pkg/api"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/spf13/cobra"
)

const (
	ansiReset  = "\033[0m"
	ansiDim    = "\033[2m"
	ansiCyan   = "\033[36m"
	ansiYellow = "\033[33m"
)

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
	sessionID       string
	printConfig     bool
	verbose         bool
	waterfall       bool
	execute         string
	skillsDirs      []string
}

func newRootCmd() *cobra.Command {
	opts := &cliOptions{
		skillsRecursive: true,
		timeoutMs:       10 * 60 * 1000,
		waterfall:       true,
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
	rootCmd.PersistentFlags().StringVar(&opts.sessionID, "session-id", "", "Session ID (default: auto-generate)")
	rootCmd.PersistentFlags().BoolVar(&opts.printConfig, "print-effective-config", false, "Print resolved runtime config before running")
	rootCmd.PersistentFlags().BoolVar(&opts.verbose, "verbose", false, "Verbose stream diagnostics")
	rootCmd.PersistentFlags().BoolVar(&opts.waterfall, "waterfall", true, "Print LLM/tool waterfall stats per request")
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
				printEffectiveConfig(cmd.OutOrStdout(), repoRoot, cfg, resolved.timeoutMs)
				printRuntimeEffectiveConfig(cmd.OutOrStdout(), eng, resolved.timeoutMs)
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
			printEffectiveConfig(cmd.OutOrStdout(), repoRoot, cfg, resolved.timeoutMs)
			printRuntimeEffectiveConfig(cmd.OutOrStdout(), eng, resolved.timeoutMs)
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
		SkillsRecursive: boolPtr(opts.skillsRecursive),
	}
	if len(opts.skillsDirs) > 0 {
		cfg.SkillsDirs = make([]string, 0, len(opts.skillsDirs))
		for _, d := range opts.skillsDirs {
			cfg.SkillsDirs = append(cfg.SkillsDirs, filepath.Clean(strings.TrimSpace(d)))
		}
	}
	if opts.printConfig {
		printEffectiveConfig(os.Stdout, repoRoot, cfg, opts.timeoutMs)
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
	if err := runStream(eng, runSessionID, prompt, opts.timeoutMs, opts.verbose, opts.waterfall); err != nil {
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

	printBanner(eng.ModelName(), eng.Skills())
	if opts.printConfig {
		printRuntimeEffectiveConfig(os.Stdout, eng, opts.timeoutMs)
	}
	runREPL(eng, opts.timeoutMs, opts.verbose, opts.waterfall, opts.sessionID)
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

func printBanner(modelName string, metas []agent.SkillMeta) {
	fmt.Printf("\nAlibaba Cloud Agent CLI\n")
	fmt.Printf("Model: %s\n", modelName)
	fmt.Printf("Skills: %d loaded\n", len(metas))
	fmt.Printf("Commands: /skills /new /model /help /quit\n\n")
}

func runREPL(eng *agent.Engine, timeoutMs int, verbose, waterfall bool, initialSessionID string) {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 1024), 1024*1024)
	sessionID := strings.TrimSpace(initialSessionID)
	if sessionID == "" {
		sessionID = uuid.NewString()
	}

	for {
		fmt.Print("> ")
		if !scanner.Scan() {
			fmt.Println("bye")
			return
		}
		input := strings.TrimSpace(scanner.Text())
		if input == "" {
			continue
		}

		if strings.HasPrefix(input, "/") {
			if handleCommand(input, eng, &sessionID) {
				return
			}
			continue
		}

		if err := runStream(eng, sessionID, input, timeoutMs, verbose, waterfall); err != nil {
			fmt.Fprintf(os.Stderr, "run failed: %v\n", err)
		}
	}
}

func handleCommand(input string, eng *agent.Engine, sessionID *string) (quit bool) {
	cmd := strings.ToLower(strings.Fields(input)[0])
	switch cmd {
	case "/quit", "/exit", "/q":
		fmt.Println("bye")
		return true
	case "/new":
		*sessionID = uuid.NewString()
		fmt.Println("new conversation")
	case "/model":
		fmt.Printf("model: %s\n", eng.ModelName())
	case "/session":
		fmt.Printf("session: %s\n", *sessionID)
	case "/help":
		fmt.Println("/skills /new /session /model /help /quit")
	case "/skills":
		metas := eng.Skills()
		sort.Slice(metas, func(i, j int) bool { return metas[i].Name < metas[j].Name })
		for _, m := range metas {
			fmt.Printf("- %s\n", m.Name)
		}
	default:
		fmt.Printf("unknown command: %s\n", cmd)
	}
	return false
}

func runStream(eng *agent.Engine, sessionID, prompt string, timeoutMs int, verbose, waterfall bool) error {
	ctx := context.Background()
	cancel := func() {}
	if timeoutMs > 0 {
		ctxWithTimeout, c := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
		ctx = ctxWithTimeout
		cancel = c
	}
	defer cancel()

	ch, err := eng.RunStream(ctx, sessionID, prompt)
	if err != nil {
		return err
	}

	tracer := newWaterfallTracer(eng, sessionID)
	toolStartAt := make(map[string]time.Time)

	for evt := range ch {
		tracer.OnEvent(evt)
		switch evt.Type {
		case api.EventContentBlockDelta:
			if evt.Delta != nil && evt.Delta.Type == "text_delta" {
				fmt.Print(evt.Delta.Text)
			}
		case api.EventToolExecutionStart:
			if evt.Name != "" {
				toolID := strings.TrimSpace(evt.ToolUseID)
				toolStartAt[toolID] = time.Now()
				if toolID != "" {
					fmt.Printf("\n[tool] %s id=%s\n", evt.Name, toolID)
				} else {
					fmt.Printf("\n[tool] %s\n", evt.Name)
				}
				if inputSummary := strings.TrimSpace(tracer.toolInputByID[toolID]); inputSummary != "" {
					fmt.Printf("  input: %s\n", truncateSummary(inputSummary, 180))
				}
			}
		case api.EventToolExecutionResult:
			if evt.Name != "" {
				toolID := strings.TrimSpace(evt.ToolUseID)
				dur := int64(0)
				if started, ok := toolStartAt[toolID]; ok {
					dur = durationMs(started, time.Now())
					delete(toolStartAt, toolID)
				}
				status := "ok"
				if evt.IsError != nil && *evt.IsError {
					status = "error"
				}
				if toolID != "" {
					fmt.Printf("\n[tool:done] %s id=%s %s %s\n", evt.Name, toolID, formatDurationMs(dur), status)
				} else {
					fmt.Printf("\n[tool:done] %s %s %s\n", evt.Name, formatDurationMs(dur), status)
				}
				outputSummary := strings.TrimSpace(truncateSummary(summarizeOutput(evt.Output), 240))
				if outputSummary != "" {
					fmt.Printf("  output: %s\n", outputSummary)
				} else if verbose {
					fmt.Printf("  output: (empty)\n")
				}
			}
		case api.EventMessageStop:
			if verbose {
				fmt.Println("\n[message_stop]")
			}
		case api.EventError:
			if evt.Output != nil {
				fmt.Fprintf(os.Stderr, "\n[error] %v\n", evt.Output)
			}
		}
	}
	fmt.Println()
	if waterfall {
		tracer.Print(os.Stderr)
	}
	return nil
}

type multiValue []string

func (m *multiValue) String() string {
	return strings.Join(*m, ",")
}

func (m *multiValue) Set(value string) error {
	*m = append(*m, value)
	return nil
}

func boolPtr(v bool) *bool { return &v }

func printEffectiveConfig(out io.Writer, repoRoot string, cfg agent.Config, timeoutMs int) {
	if out == nil {
		return
	}
	fmt.Fprintf(out, "effective-config (pre-runtime)\n")
	fmt.Fprintf(out, "  repo_root: %s\n", repoRoot)
	fmt.Fprintf(out, "  model: %s\n", cfg.ModelName)
	fmt.Fprintf(out, "  config_root: %s\n", strings.TrimSpace(cfg.ConfigRoot))
	fmt.Fprintf(out, "  timeout_ms: %d\n", timeoutMs)
	if cfg.SkillsRecursive == nil {
		fmt.Fprintf(out, "  skills_recursive: true (default)\n")
	} else {
		fmt.Fprintf(out, "  skills_recursive: %v\n", *cfg.SkillsRecursive)
	}
	if len(cfg.SkillsDirs) == 0 {
		fmt.Fprintf(out, "  skills_dirs: (auto)\n")
	} else {
		fmt.Fprintf(out, "  skills_dirs:\n")
		for _, d := range cfg.SkillsDirs {
			fmt.Fprintf(out, "    - %s\n", d)
		}
	}
}

func printRuntimeEffectiveConfig(out io.Writer, eng *agent.Engine, timeoutMs int) {
	if out == nil {
		return
	}
	fmt.Fprintf(out, "effective-config (runtime)\n")
	fmt.Fprintf(out, "  model: %s\n", eng.ModelName())
	fmt.Fprintf(out, "  config_root: %s\n", eng.SettingsRoot())
	fmt.Fprintf(out, "  timeout_ms: %d\n", timeoutMs)
	fmt.Fprintf(out, "  skills_recursive: %v\n", eng.SkillsRecursive())
	dirs := eng.SkillsDirs()
	if len(dirs) == 0 {
		fmt.Fprintf(out, "  skills_dirs: (none)\n")
	} else {
		fmt.Fprintf(out, "  skills_dirs:\n")
		for _, d := range dirs {
			fmt.Fprintf(out, "    - %s\n", d)
		}
	}
}

type waterfallStep struct {
	Kind         string
	Name         string
	ToolUseID    string
	Start        time.Time
	End          time.Time
	DurationMs   int64
	Summary      string
	InputTokens  int
	OutputTokens int
	TotalTokens  int
}

type waterfallTracer struct {
	eng            *agent.Engine
	sessionID      string
	runStart       time.Time
	modelTurnIndex int
	llmRound       int
	toolOpen       map[string]*waterfallStep
	toolOrder      []string
	toolInputByID  map[string]string
	toolInputParts map[int]*toolInputPart
	currentLLM     *waterfallStep
	steps          []waterfallStep
}

type toolInputPart struct {
	toolUseID string
	name      string
	inputRaw  strings.Builder
}

func newWaterfallTracer(eng *agent.Engine, sessionID string) *waterfallTracer {
	return &waterfallTracer{
		eng:            eng,
		sessionID:      sessionID,
		runStart:       time.Now(),
		modelTurnIndex: eng.ModelTurnCount(sessionID),
		toolOpen:       make(map[string]*waterfallStep),
		toolInputByID:  make(map[string]string),
		toolInputParts: make(map[int]*toolInputPart),
	}
}

func (w *waterfallTracer) OnEvent(evt api.StreamEvent) {
	if w == nil {
		return
	}
	now := time.Now()
	switch evt.Type {
	case api.EventMessageStart:
		if w.currentLLM == nil {
			w.llmRound++
			w.currentLLM = &waterfallStep{
				Kind:  "llm",
				Name:  fmt.Sprintf("llm_round_%d", w.llmRound),
				Start: now,
			}
		}
	case api.EventContentBlockDelta:
		w.appendLLMDelta(evt)
		w.appendToolInputDelta(evt)
	case api.EventContentBlockStart:
		w.startToolInput(evt)
	case api.EventContentBlockStop:
		w.finishToolInput(evt)
	case api.EventMessageStop:
		w.finishLLMStep(now)
	case api.EventToolExecutionStart:
		w.startToolStep(now, evt)
	case api.EventToolExecutionResult:
		w.finishToolStep(now, evt)
	case api.EventError:
		w.finishLLMStep(now)
	}
}

func (w *waterfallTracer) appendLLMDelta(evt api.StreamEvent) {
	if w.currentLLM == nil || evt.Delta == nil || evt.Delta.Type != "text_delta" {
		return
	}
	w.currentLLM.Summary += evt.Delta.Text
	if runeCount(w.currentLLM.Summary) > 200 {
		w.currentLLM.Summary = truncateSummary(w.currentLLM.Summary, 200)
	}
}

func (w *waterfallTracer) startToolStep(now time.Time, evt api.StreamEvent) {
	key := strings.TrimSpace(evt.ToolUseID)
	inputSummary := truncateSummary(strings.TrimSpace(w.toolInputByID[key]), 120)
	step := &waterfallStep{
		Kind:      "tool",
		Name:      strings.TrimSpace(evt.Name),
		ToolUseID: key,
		Start:     now,
		Summary:   inputSummary,
	}
	if key == "" {
		key = fmt.Sprintf("%s#%d", step.Name, len(w.toolOrder)+1)
	}
	w.toolOpen[key] = step
	w.toolOrder = append(w.toolOrder, key)
}

func (w *waterfallTracer) finishToolStep(now time.Time, evt api.StreamEvent) {
	key := strings.TrimSpace(evt.ToolUseID)
	step, ok := w.toolOpen[key]
	if !ok {
		for i := len(w.toolOrder) - 1; i >= 0; i-- {
			candidate := w.toolOrder[i]
			s := w.toolOpen[candidate]
			if s != nil && s.Name == strings.TrimSpace(evt.Name) {
				key = candidate
				step = s
				ok = true
				break
			}
		}
	}
	if !ok || step == nil {
		return
	}
	step.End = now
	step.DurationMs = durationMs(step.Start, step.End)
	outputSummary := truncateSummary(summarizeOutput(evt.Output), 120)
	if step.Summary != "" && outputSummary != "" {
		step.Summary = truncateSummary(step.Summary+" -> "+outputSummary, 120)
	} else if outputSummary != "" {
		step.Summary = outputSummary
	}
	if evt.IsError != nil && *evt.IsError {
		if step.Summary != "" {
			step.Summary = truncateSummary(step.Summary+"; status=error", 120)
		} else {
			step.Summary = "status=error"
		}
	}
	w.steps = append(w.steps, *step)
	delete(w.toolOpen, key)
}

func (w *waterfallTracer) finishLLMStep(now time.Time) {
	if w.currentLLM == nil {
		return
	}
	step := w.currentLLM
	step.End = now
	step.DurationMs = durationMs(step.Start, step.End)
	turns := w.eng.ModelTurnsSince(w.sessionID, w.modelTurnIndex)
	if len(turns) > 0 {
		turn := turns[0]
		w.modelTurnIndex++
		step.InputTokens = turn.InputTokens
		step.OutputTokens = turn.OutputTokens
		step.TotalTokens = turn.TotalTokens
		summary := strings.TrimSpace(turn.Preview)
		if summary == "" {
			summary = strings.TrimSpace(step.Summary)
		}
		if strings.TrimSpace(turn.StopReason) != "" {
			if summary != "" {
				summary += "; "
			}
			summary += "stop=" + strings.TrimSpace(turn.StopReason)
		}
		step.Summary = truncateSummary(summary, 120)
	}
	w.steps = append(w.steps, *step)
	w.currentLLM = nil
}

func (w *waterfallTracer) Print(out io.Writer) {
	if w == nil || out == nil {
		return
	}
	if w.currentLLM != nil {
		w.finishLLMStep(time.Now())
	}
	now := time.Now()
	for _, key := range w.toolOrder {
		step := w.toolOpen[key]
		if step == nil {
			continue
		}
		step.End = now
		step.DurationMs = durationMs(step.Start, step.End)
		if step.Summary == "" {
			step.Summary = "unfinished"
		}
		w.steps = append(w.steps, *step)
		delete(w.toolOpen, key)
	}
	if len(w.steps) == 0 {
		fmt.Fprintln(out, "\n[waterfall] no llm/tool steps captured")
		return
	}

	total := durationMs(w.runStart, now)
	var totalIn, totalOut, totalTokens int
	var llmCount, toolCount int
	var maxDuration int64
	for _, step := range w.steps {
		totalIn += step.InputTokens
		totalOut += step.OutputTokens
		totalTokens += step.TotalTokens
		if step.Kind == "llm" {
			llmCount++
		} else if step.Kind == "tool" {
			toolCount++
		}
		if step.DurationMs > maxDuration {
			maxDuration = step.DurationMs
		}
	}

	fmt.Fprintln(out, "\n[waterfall]")
	fmt.Fprintf(out, "  summary: total_ms=%d steps=%d llm=%d tool=%d llm_tokens=%d/%d/%d session=%s\n",
		total, len(w.steps), llmCount, toolCount, totalIn, totalOut, totalTokens, w.sessionID)
	fmt.Fprintln(out, "  timeline:")
	const maxBarWidth = 24
	useANSI := supportsANSI(out)
	for i, step := range w.steps {
		startMs := durationMs(w.runStart, step.Start)
		share := 0.0
		if total > 0 {
			share = float64(step.DurationMs) * 100 / float64(total)
		}
		bar := renderDurationBar(step.DurationMs, maxDuration, maxBarWidth)
		label := truncateSummary(step.Name, 24)
		detail := truncateSummary(step.Summary, 90)
		barColor := ansiCyan
		if step.Kind == "llm" {
			label = fmt.Sprintf("LLM #%d", i+1)
			detail = fmt.Sprintf("in=%d out=%d total=%d", step.InputTokens, step.OutputTokens, step.TotalTokens)
			if strings.TrimSpace(step.Summary) != "" {
				detail += " | " + truncateSummary(step.Summary, 64)
			}
			barColor = ansiYellow
		} else {
			label = "Tool-" + label
		}
		if useANSI {
			label = colorize(label, barColor, true)
			bar = colorize(bar, barColor, true)
			detail = colorize(detail, ansiDim, true)
		}
		fmt.Fprintf(out, "    %6.1fs | %-18s %s %6s %5.1f%% %s\n",
			float64(startMs)/1000.0,
			label,
			bar,
			formatDurationMs(step.DurationMs),
			share,
			detail,
		)
	}
	fmt.Fprintf(out, "    %6.1fs | done\n", float64(total)/1000.0)
	fmt.Fprintf(out, "  total: total_ms=%d llm_tokens=%d/%d/%d session=%s\n", total, totalIn, totalOut, totalTokens, w.sessionID)
}

func durationMs(start, end time.Time) int64 {
	if start.IsZero() || end.IsZero() {
		return 0
	}
	ms := end.Sub(start).Milliseconds()
	if ms < 0 {
		return 0
	}
	return ms
}

func summarizeOutput(v any) string {
	if v == nil {
		return ""
	}
	switch typed := v.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []byte:
		return strings.TrimSpace(string(typed))
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return strings.TrimSpace(string(raw))
}

func truncateSummary(s string, max int) string {
	s = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(s, "\n", " "), "\r", " "), "\t", " "))
	if max <= 0 {
		return s
	}
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	if max <= 3 {
		return string(runes[:max])
	}
	return string(runes[:max-3]) + "..."
}

func runeCount(s string) int {
	return len([]rune(s))
}

func renderDurationBar(dur, max int64, width int) string {
	if width <= 0 {
		return ""
	}
	filled := 1
	if max > 0 {
		filled = int(float64(width) * float64(dur) / float64(max))
		if filled < 1 {
			filled = 1
		}
		if filled > width {
			filled = width
		}
	}
	return strings.Repeat("#", filled) + strings.Repeat(".", width-filled)
}

func formatDurationMs(ms int64) string {
	if ms < 1000 {
		return fmt.Sprintf("%dms", ms)
	}
	seconds := float64(ms) / 1000.0
	if seconds < 10 {
		return fmt.Sprintf("%.2fs", seconds)
	}
	return fmt.Sprintf("%.1fs", seconds)
}

func (w *waterfallTracer) startToolInput(evt api.StreamEvent) {
	if w == nil || evt.ContentBlock == nil || evt.Index == nil {
		return
	}
	block := evt.ContentBlock
	if strings.TrimSpace(block.Type) != "tool_use" {
		return
	}
	idx := *evt.Index
	w.toolInputParts[idx] = &toolInputPart{
		toolUseID: strings.TrimSpace(block.ID),
		name:      strings.TrimSpace(block.Name),
	}
}

func (w *waterfallTracer) appendToolInputDelta(evt api.StreamEvent) {
	if w == nil || evt.Index == nil || evt.Delta == nil || evt.Delta.Type != "input_json_delta" {
		return
	}
	part := w.toolInputParts[*evt.Index]
	if part == nil {
		return
	}
	part.inputRaw.WriteString(decodeInputJSONChunk(evt.Delta.PartialJSON))
}

func (w *waterfallTracer) finishToolInput(evt api.StreamEvent) {
	if w == nil || evt.Index == nil {
		return
	}
	idx := *evt.Index
	part := w.toolInputParts[idx]
	if part == nil {
		return
	}
	raw := strings.TrimSpace(part.inputRaw.String())
	if raw != "" && part.toolUseID != "" {
		w.toolInputByID[part.toolUseID] = summarizeToolInput(raw)
	}
	delete(w.toolInputParts, idx)
}

func decodeInputJSONChunk(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var chunk string
	if err := json.Unmarshal(raw, &chunk); err == nil {
		return chunk
	}
	return string(raw)
}

func summarizeToolInput(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return truncateSummary(raw, 120)
	}
	keys := []string{"description", "command", "file_path", "path", "url", "query", "glob_pattern", "pattern", "text", "prompt"}
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		v, ok := m[k]
		if !ok {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s=%q", k, truncateSummary(summarizeOutput(v), 48)))
		if len(parts) >= 3 {
			break
		}
	}
	if len(parts) == 0 {
		return truncateSummary(raw, 120)
	}
	return strings.Join(parts, " ")
}

func supportsANSI(out io.Writer) bool {
	if strings.TrimSpace(os.Getenv("NO_COLOR")) != "" {
		return false
	}
	if v := strings.TrimSpace(os.Getenv("CLICOLOR_FORCE")); v == "1" {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("TERM")), "dumb") {
		return false
	}
	f, ok := out.(*os.File)
	if !ok {
		return false
	}
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return (info.Mode() & os.ModeCharDevice) != 0
}

func colorize(s, ansi string, enabled bool) string {
	if !enabled || s == "" || ansi == "" {
		return s
	}
	return ansi + s + ansiReset
}
