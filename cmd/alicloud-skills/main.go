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

	"github.com/cinience/alicloud-skills/internal/agent"
	"github.com/godeps/agentkit/pkg/api"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	var (
		modelName string
		skillsDir string
		execute   string
	)
	flag.StringVar(&modelName, "model", agent.DefaultModel, "Model name")
	flag.StringVar(&skillsDir, "skills-dir", "", "Skills directory")
	flag.StringVar(&execute, "e", "", "Execute a single prompt and exit")
	flag.StringVar(&execute, "execute", "", "Execute a single prompt and exit")
	flag.Parse()

	repoRoot := agent.ResolveRepoRoot("")
	cfg := agent.Config{RepoRoot: repoRoot, ModelName: modelName}
	if skillsDir != "" {
		cfg.SkillsDirs = []string{filepath.Clean(skillsDir)}
	}

	eng, err := agent.NewEngine(context.Background(), cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "init failed: %v\n", err)
		os.Exit(1)
	}
	defer eng.Close()

	if execute != "" {
		if err := runStream(eng, uuid.NewString(), execute); err != nil {
			fmt.Fprintf(os.Stderr, "run failed: %v\n", err)
			os.Exit(1)
		}
		return
	}

	printBanner(eng.ModelName(), eng.Skills())
	runREPL(eng)
}

func printBanner(modelName string, metas []agent.SkillMeta) {
	fmt.Printf("\nAlibaba Cloud Agent CLI\n")
	fmt.Printf("Model: %s\n", modelName)
	fmt.Printf("Skills: %d loaded\n", len(metas))
	fmt.Printf("Commands: /skills /new /model /help /quit\n\n")
}

func runREPL(eng *agent.Engine) {
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

		if err := runStream(eng, sessionID, input); err != nil {
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

func runStream(eng *agent.Engine, sessionID, prompt string) error {
	ch, err := eng.RunStream(context.Background(), sessionID, prompt)
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
