package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/cinience/alicloud-skills/internal/agent"
	"github.com/godeps/agentkit/pkg/api"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	var (
		modelName       string
		configRoot      string
		skillsRecursive bool
		timeoutMs       int
		execute         string
	)
	flag.StringVar(&modelName, "model", agent.DefaultModel, "Model name")
	flag.StringVar(&configRoot, "config-root", "", "Config root directory (settings.json/settings.local.json)")
	flag.BoolVar(&skillsRecursive, "skills-recursive", true, "Discover SKILL.md recursively")
	flag.IntVar(&timeoutMs, "timeout-ms", 10*60*1000, "Run timeout in milliseconds")
	flag.StringVar(&execute, "e", "", "Execute a single prompt and exit")
	flag.StringVar(&execute, "execute", "", "Execute a single prompt and exit")
	var skillsDirs multiValue
	flag.Var(&skillsDirs, "skills-dir", "Skills directory (repeatable)")
	flag.Parse()

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

	eng, err := agent.NewEngine(context.Background(), cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "init failed: %v\n", err)
		os.Exit(1)
	}
	defer eng.Close()

	if execute != "" {
		if err := runStream(eng, uuid.NewString(), execute, timeoutMs); err != nil {
			fmt.Fprintf(os.Stderr, "run failed: %v\n", err)
			os.Exit(1)
		}
		return
	}

	printBanner(eng.ModelName(), eng.Skills())
	runREPL(eng, timeoutMs)
}

func printBanner(modelName string, metas []agent.SkillMeta) {
	fmt.Printf("\nAlibaba Cloud Agent CLI\n")
	fmt.Printf("Model: %s\n", modelName)
	fmt.Printf("Skills: %d loaded\n", len(metas))
	fmt.Printf("Commands: /skills /new /model /help /quit\n\n")
}

func runREPL(eng *agent.Engine, timeoutMs int) {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 1024), 1024*1024)
	sessionID := uuid.NewString()

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

		if err := runStream(eng, sessionID, input, timeoutMs); err != nil {
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
	case "/help":
		fmt.Println("/skills /new /model /help /quit")
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

func runStream(eng *agent.Engine, sessionID, prompt string, timeoutMs int) error {
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
