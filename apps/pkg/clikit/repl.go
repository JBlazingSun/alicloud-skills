package clikit

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/google/uuid"
)

func PrintBanner(modelName string, metas []SkillMeta) {
	fmt.Printf("\nAlibaba Cloud Agent CLI\n")
	fmt.Printf("Model: %s\n", modelName)
	fmt.Printf("Skills: %d loaded\n", len(metas))
	fmt.Printf("Commands: /skills /new /model /help /quit\n\n")
}

func RunREPL(ctx context.Context, eng ReplEngine, timeoutMs int, verbose bool, waterfallMode string, initialSessionID string) {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 1024), 1024*1024)
	sessionID := strings.TrimSpace(initialSessionID)
	if sessionID == "" {
		sessionID = uuid.NewString()
	}

	for {
		fmt.Print("> ")
		if !scanner.Scan() {
			break
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

		if err := RunStream(ctx, eng, sessionID, input, timeoutMs, verbose, waterfallMode); err != nil {
			fmt.Fprintf(os.Stderr, "run failed: %v\n", err)
		}
	}
	if err := scanner.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "read failed: %v\n", err)
	}
	fmt.Println("bye")
}

func handleCommand(input string, eng ReplEngine, sessionID *string) (quit bool) {
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
