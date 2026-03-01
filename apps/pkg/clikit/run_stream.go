package clikit

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/godeps/agentkit/pkg/api"
)

func RunStream(parent context.Context, eng StreamEngine, sessionID, prompt string, timeoutMs int, verbose bool, waterfallMode string) error {
	runStartedAt := time.Now()
	ctx := parent
	if ctx == nil {
		ctx = context.Background()
	}
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
	toolNameByID := make(map[string]string)
	llmBlockOpen := false
	llmTextBuffer := strings.Builder{}
	lastLLMResponse := ""
	useANSI := supportsANSI(os.Stdout)
	var imageArtifact *artifactInfo

	for evt := range ch {
		tracer.OnEvent(evt)
		switch evt.Type {
		case api.EventContentBlockDelta:
			if evt.Delta != nil && evt.Delta.Type == "text_delta" {
				if !llmBlockOpen {
					printBlockHeader(os.Stdout, "LLM RESPONSE")
					llmBlockOpen = true
					llmTextBuffer.Reset()
				}
				fmt.Print(evt.Delta.Text)
				llmTextBuffer.WriteString(evt.Delta.Text)
			}
		case api.EventToolExecutionStart:
			if llmBlockOpen {
				lastLLMResponse = strings.TrimSpace(llmTextBuffer.String())
				toolID := strings.TrimSpace(evt.ToolUseID)
				if hint := buildLLMToolHint(llmTextBuffer.String(), evt.Name, tracer.toolInputByID[toolID]); hint != "" {
					fmt.Println(colorize(hint, ansiDim, useANSI))
				}
				printBlockFooter(os.Stdout)
				llmBlockOpen = false
			}
			if evt.Name != "" {
				toolID := strings.TrimSpace(evt.ToolUseID)
				toolNameByID[toolID] = evt.Name
				toolStartAt[toolID] = time.Now()
				inputSummary := strings.TrimSpace(tracer.toolInputByID[toolID])
				printToolProgressLine(os.Stdout, useANSI, "running", evt.Name, toolID, 0, inputSummary, "")
			}
		case api.EventToolExecutionResult:
			if llmBlockOpen {
				printBlockFooter(os.Stdout)
				llmBlockOpen = false
			}
			toolID := strings.TrimSpace(evt.ToolUseID)
			toolName := resolveToolResultName(evt.Name, toolNameByID[toolID])
			if toolName != "" {
				dur := int64(0)
				if started, ok := toolStartAt[toolID]; ok {
					dur = durationMs(started, time.Now())
					delete(toolStartAt, toolID)
				}
				status := "ok"
				if evt.IsError != nil && *evt.IsError {
					status = "error"
				}
				outputSummary := strings.TrimSpace(truncateSummaryHeadTail(summarizeOutput(evt.Output), 120, 80))
				printToolProgressLine(os.Stdout, useANSI, status, toolName, toolID, dur, "", outputSummary)
				if status == "ok" {
					if a, ok := detectArtifactInfo(evt.Output); ok {
						imageArtifact = &a
					}
				}
			}
		case api.EventMessageStop:
			if llmBlockOpen {
				lastLLMResponse = strings.TrimSpace(llmTextBuffer.String())
				printBlockFooter(os.Stdout)
				llmBlockOpen = false
			}
			if verbose {
				printBlockHeader(os.Stdout, "MESSAGE STOP")
				fmt.Println("status: completed")
				printBlockFooter(os.Stdout)
			}
		case api.EventError:
			if llmBlockOpen {
				lastLLMResponse = strings.TrimSpace(llmTextBuffer.String())
				printBlockFooter(os.Stdout)
				llmBlockOpen = false
			}
			if evt.Output != nil {
				printBlockHeader(os.Stderr, "ERROR")
				fmt.Fprintf(os.Stderr, "%v\n", evt.Output)
				printBlockFooter(os.Stderr)
			}
		}
	}
	if llmBlockOpen {
		lastLLMResponse = strings.TrimSpace(llmTextBuffer.String())
		printBlockFooter(os.Stdout)
	}
	if imageArtifact != nil {
		printArtifactCard(os.Stdout, useANSI, *imageArtifact)
	}
	paths := chooseValidationPaths(lastLLMResponse, imageArtifact)
	results, err := validateGeneratedOutputsDetailed(eng.RepoRoot(), paths, runStartedAt)
	printValidationReport(os.Stdout, paths, results)
	if err != nil {
		printBlockHeader(os.Stderr, "ERROR")
		fmt.Fprintln(os.Stderr, err.Error())
		printBlockFooter(os.Stderr)
		return err
	}
	if NormalizeWaterfallMode(waterfallMode) != WaterfallModeOff {
		tracer.Print(os.Stdout, NormalizeWaterfallMode(waterfallMode))
	}
	return nil
}

func chooseValidationPaths(lastLLMResponse string, artifact *artifactInfo) []string {
	llmPaths := detectOutputPathsFromText(lastLLMResponse)
	if len(llmPaths) > 0 {
		return llmPaths
	}
	if artifact == nil {
		return nil
	}
	path := filepath.Clean(strings.TrimSpace(artifact.Path))
	if path == "" {
		return nil
	}
	return []string{path}
}

func printValidationReport(out *os.File, paths []string, results []outputValidationResult) {
	if out == nil {
		return
	}
	printBlockHeader(out, "POST VALIDATION")
	if len(paths) == 0 {
		fmt.Fprintln(out, "no candidate outputs detected")
		printBlockFooter(out)
		return
	}
	fmt.Fprintf(out, "candidates: %d\n", len(paths))
	for _, p := range paths {
		fmt.Fprintf(out, "- %s\n", p)
	}
	for _, r := range results {
		status := "ok"
		if strings.TrimSpace(r.Err) != "" {
			status = "failed"
		}
		if r.IsDir {
			status = "skip-dir"
		}
		line := fmt.Sprintf("* %s status=%s exists=%v fresh=%v", r.Path, status, r.Exists, r.Fresh)
		if r.JSONChecked {
			line += fmt.Sprintf(" json_valid=%v", r.JSONValid)
		}
		if strings.TrimSpace(r.Err) != "" {
			line += fmt.Sprintf(" err=%s", r.Err)
		}
		fmt.Fprintln(out, line)
	}
	printBlockFooter(out)
}
