package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
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
)

const (
	ansiReset  = "\033[0m"
	ansiDim    = "\033[2m"
	ansiCyan   = "\033[36m"
	ansiYellow = "\033[33m"
)

func main() {
	if topic, ok := detectSubcommandHelp(os.Args[1:]); ok {
		printSubcommandHelp(os.Stdout, topic)
		return
	}

	_ = godotenv.Load()

	var (
		modelName       string
		configRoot      string
		skillsRecursive bool
		timeoutMs       int
		sessionID       string
		printConfig     bool
		verbose         bool
		waterfall       bool
		execute         string
	)
	flag.StringVar(&modelName, "model", "", "Model name")
	flag.StringVar(&configRoot, "config-root", "", "Config root directory (settings.json/settings.local.json)")
	flag.BoolVar(&skillsRecursive, "skills-recursive", true, "Discover SKILL.md recursively")
	flag.IntVar(&timeoutMs, "timeout-ms", 10*60*1000, "Run timeout in milliseconds")
	flag.StringVar(&sessionID, "session-id", "", "Session ID for one-shot mode (default: auto-generate)")
	flag.BoolVar(&printConfig, "print-effective-config", false, "Print resolved runtime config before running")
	flag.BoolVar(&verbose, "verbose", false, "Verbose stream diagnostics")
	flag.BoolVar(&waterfall, "waterfall", true, "Print LLM/tool waterfall stats per request")
	flag.StringVar(&execute, "e", "", "Execute a single prompt and exit")
	flag.StringVar(&execute, "execute", "", "Execute a single prompt and exit")
	var skillsDirs multiValue
	flag.Var(&skillsDirs, "skills-dir", "Skills directory (repeatable)")
	flag.Parse()

	if strings.TrimSpace(modelName) == "" {
		modelName = strings.TrimSpace(os.Getenv("ALICLOUD_SKILLS_MODEL"))
	}
	if strings.TrimSpace(modelName) == "" {
		modelName = agent.DefaultModel
	}
	if strings.TrimSpace(configRoot) == "" {
		configRoot = strings.TrimSpace(os.Getenv("ALICLOUD_SKILLS_SETTINGS_ROOT"))
	}
	if v := strings.TrimSpace(os.Getenv("ALICLOUD_SKILLS_TIMEOUT_MS")); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			timeoutMs = parsed
		}
	}
	if v := strings.TrimSpace(os.Getenv("ALICLOUD_SKILLS_SKILLS_RECURSIVE")); v != "" {
		if parsed, err := strconv.ParseBool(v); err == nil {
			skillsRecursive = parsed
		}
	}

	repoRoot := agent.ResolveRepoRoot("")
	cfg := agent.Config{
		RepoRoot:        repoRoot,
		ConfigRoot:      strings.TrimSpace(configRoot),
		ModelName:       modelName,
		SkillsRecursive: boolPtr(skillsRecursive),
	}
	if len(skillsDirs) > 0 {
		cfg.SkillsDirs = make([]string, 0, len(skillsDirs))
		for _, d := range skillsDirs {
			cfg.SkillsDirs = append(cfg.SkillsDirs, filepath.Clean(strings.TrimSpace(d)))
		}
	}
	if printConfig {
		printEffectiveConfig(os.Stdout, repoRoot, cfg, timeoutMs)
	}

	eng, err := agent.NewEngine(context.Background(), cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "init failed: %v\n", err)
		os.Exit(1)
	}
	defer eng.Close()

	if execute != "" {
		runSessionID := strings.TrimSpace(sessionID)
		if runSessionID == "" {
			runSessionID = uuid.NewString()
		}
		if err := runStream(eng, runSessionID, execute, timeoutMs, verbose, waterfall); err != nil {
			fmt.Fprintf(os.Stderr, "run failed: %v\n", err)
			os.Exit(1)
		}
		return
	}

	printBanner(eng.ModelName(), eng.Skills())
	if printConfig {
		printRuntimeEffectiveConfig(os.Stdout, eng, timeoutMs)
	}
	runREPL(eng, timeoutMs, verbose, waterfall, sessionID)
}

func detectSubcommandHelp(args []string) (string, bool) {
	if len(args) == 0 {
		return "", false
	}

	first := strings.ToLower(strings.TrimSpace(args[0]))
	rest := args[1:]

	isHelpFlag := func(v string) bool {
		v = strings.ToLower(strings.TrimSpace(v))
		return v == "-h" || v == "--help" || v == "help"
	}

	hasHelpFlag := func(list []string) bool {
		for _, a := range list {
			if isHelpFlag(a) {
				return true
			}
		}
		return false
	}

	switch first {
	case "help":
		if len(rest) == 0 {
			return "root", true
		}
		switch strings.ToLower(strings.TrimSpace(rest[0])) {
		case "run":
			return "run", true
		case "api":
			return "api", true
		default:
			return "root", true
		}
	case "run":
		if hasHelpFlag(rest) {
			return "run", true
		}
	case "api":
		if hasHelpFlag(rest) {
			return "api", true
		}
	}

	return "", false
}

func printSubcommandHelp(out io.Writer, topic string) {
	if out == nil {
		return
	}
	switch topic {
	case "run":
		fmt.Fprintln(out, "alicloud-skills run: execute mode")
		fmt.Fprintln(out, "")
		fmt.Fprintln(out, "Use root flags for one-shot execution:")
		fmt.Fprintln(out, "  alicloud-skills -e \"<prompt>\" [flags]")
		fmt.Fprintln(out, "")
		fmt.Fprintln(out, "Useful flags:")
		fmt.Fprintln(out, "  -e, --execute     Execute a single prompt and exit")
		fmt.Fprintln(out, "  -timeout-ms       Run timeout in milliseconds")
		fmt.Fprintln(out, "  -session-id       Session ID for one-shot mode")
		fmt.Fprintln(out, "  -model            Model name")
		fmt.Fprintln(out, "  -skills-dir       Skills directory (repeatable)")
		fmt.Fprintln(out, "")
		fmt.Fprintln(out, "Examples:")
		fmt.Fprintln(out, "  alicloud-skills -e \"ping\"")
		fmt.Fprintln(out, "  alicloud-skills -e \"列出 ECS 实例\" -timeout-ms 120000")
	case "api":
		fmt.Fprintln(out, "alicloud-skills api: API mode")
		fmt.Fprintln(out, "")
		fmt.Fprintln(out, "A dedicated `api` subcommand is not implemented in this CLI.")
		fmt.Fprintln(out, "Use one-shot mode instead:")
		fmt.Fprintln(out, "  alicloud-skills -e \"<prompt>\" [flags]")
	default:
		fmt.Fprintln(out, "Alibaba Cloud Agent CLI")
		fmt.Fprintln(out, "")
		fmt.Fprintln(out, "Usage:")
		fmt.Fprintln(out, "  alicloud-skills [flags]")
		fmt.Fprintln(out, "  alicloud-skills -e \"<prompt>\" [flags]")
		fmt.Fprintln(out, "  alicloud-skills help [run|api]")
		fmt.Fprintln(out, "")
		fmt.Fprintln(out, "Subcommand help shortcuts:")
		fmt.Fprintln(out, "  alicloud-skills run --help")
		fmt.Fprintln(out, "  alicloud-skills api --help")
		fmt.Fprintln(out, "")
		fmt.Fprintln(out, "For full flag list: alicloud-skills --help")
	}
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
	if len(w.currentLLM.Summary) > 200 {
		w.currentLLM.Summary = w.currentLLM.Summary[:197] + "..."
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

	fmt.Fprintln(out, "\n[waterfall] summary")
	fmt.Fprintf(out, "[waterfall] total_ms=%d steps=%d llm=%d tool=%d llm_tokens=%d/%d/%d session=%s\n",
		total, len(w.steps), llmCount, toolCount, totalIn, totalOut, totalTokens, w.sessionID)
	fmt.Fprintln(out, "[waterfall] timeline")
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
		fmt.Fprintf(out, "[waterfall] %6.1fs | %-18s %s %6s %5.1f%% %s\n",
			float64(startMs)/1000.0,
			label,
			bar,
			formatDurationMs(step.DurationMs),
			share,
			detail,
		)
	}
	fmt.Fprintf(out, "[waterfall] %6.1fs | done\n", float64(total)/1000.0)
	fmt.Fprintf(out, "[waterfall] total_ms=%d llm_tokens=%d/%d/%d session=%s\n", total, totalIn, totalOut, totalTokens, w.sessionID)
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
	if max <= 0 || len(s) <= max {
		return s
	}
	if max <= 3 {
		return s[:max]
	}
	return s[:max-3] + "..."
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
