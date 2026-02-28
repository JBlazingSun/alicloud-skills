package main

import (
	"bufio"
	"context"
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
		execute         string
	)
	flag.StringVar(&modelName, "model", "", "Model name")
	flag.StringVar(&configRoot, "config-root", "", "Config root directory (settings.json/settings.local.json)")
	flag.BoolVar(&skillsRecursive, "skills-recursive", true, "Discover SKILL.md recursively")
	flag.IntVar(&timeoutMs, "timeout-ms", 10*60*1000, "Run timeout in milliseconds")
	flag.StringVar(&sessionID, "session-id", "", "Session ID for one-shot mode (default: auto-generate)")
	flag.BoolVar(&printConfig, "print-effective-config", false, "Print resolved runtime config before running")
	flag.BoolVar(&verbose, "verbose", false, "Verbose stream diagnostics")
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
		if err := runStream(eng, runSessionID, execute, timeoutMs, verbose); err != nil {
			fmt.Fprintf(os.Stderr, "run failed: %v\n", err)
			os.Exit(1)
		}
		return
	}

	printBanner(eng.ModelName(), eng.Skills())
	if printConfig {
		printRuntimeEffectiveConfig(os.Stdout, eng, timeoutMs)
	}
	runREPL(eng, timeoutMs, verbose, sessionID)
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

func runREPL(eng *agent.Engine, timeoutMs int, verbose bool, initialSessionID string) {
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

		if err := runStream(eng, sessionID, input, timeoutMs, verbose); err != nil {
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

func runStream(eng *agent.Engine, sessionID, prompt string, timeoutMs int, verbose bool) error {
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

	for evt := range ch {
		switch evt.Type {
		case api.EventContentBlockDelta:
			if evt.Delta != nil && evt.Delta.Type == "text_delta" {
				fmt.Print(evt.Delta.Text)
			}
		case api.EventToolExecutionStart:
			if evt.Name != "" {
				fmt.Printf("\n[tool] %s\n", evt.Name)
			}
		case api.EventToolExecutionResult:
			if verbose && evt.Name != "" {
				fmt.Printf("\n[tool:done] %s\n", evt.Name)
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
