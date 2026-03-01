package main

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/cinience/alicloud-skills/internal/agent"
)

func TestMultiValueSet(t *testing.T) {
	var m multiValue
	if err := m.Set("/a"); err != nil {
		t.Fatalf("set: %v", err)
	}
	if err := m.Set("/b"); err != nil {
		t.Fatalf("set: %v", err)
	}
	if got := m.String(); got != "/a,/b" {
		t.Fatalf("unexpected value: %s", got)
	}
}

func TestPrintEffectiveConfig(t *testing.T) {
	var buf bytes.Buffer
	cfg := agent.Config{
		ModelName:       "m",
		ConfigRoot:      "/cfg",
		SkillsDirs:      []string{"/s1", "/s2"},
		SkillsRecursive: boolPtr(true),
	}
	printEffectiveConfig(&buf, "/repo", cfg, 1000)
	out := buf.String()
	for _, sub := range []string{"repo_root: /repo", "model: m", "config_root: /cfg", "skills_dirs:"} {
		if !strings.Contains(out, sub) {
			t.Fatalf("missing %q in output: %s", sub, out)
		}
	}
}

func TestDetectSubcommandHelp(t *testing.T) {
	cases := []struct {
		name   string
		args   []string
		want   string
		wantOK bool
	}{
		{name: "run help flag", args: []string{"run", "--help"}, want: "run", wantOK: true},
		{name: "api help short", args: []string{"api", "-h"}, want: "api", wantOK: true},
		{name: "help run", args: []string{"help", "run"}, want: "run", wantOK: true},
		{name: "help root", args: []string{"help"}, want: "root", wantOK: true},
		{name: "normal flags", args: []string{"-e", "ping"}, want: "", wantOK: false},
		{name: "run without help", args: []string{"run"}, want: "", wantOK: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := detectSubcommandHelp(tc.args)
			if ok != tc.wantOK || got != tc.want {
				t.Fatalf("detectSubcommandHelp(%v) = (%q,%v), want (%q,%v)", tc.args, got, ok, tc.want, tc.wantOK)
			}
		})
	}
}

func TestPrintSubcommandHelp(t *testing.T) {
	var buf bytes.Buffer
	printSubcommandHelp(&buf, "run")
	out := buf.String()
	for _, sub := range []string{"alicloud-skills run: execute mode", "alicloud-skills -e"} {
		if !strings.Contains(out, sub) {
			t.Fatalf("missing %q in output: %s", sub, out)
		}
	}
}

func TestTruncateSummary(t *testing.T) {
	got := truncateSummary("  a    b   c  ", 5)
	if got != "a ..." {
		t.Fatalf("unexpected truncate result: %q", got)
	}
	if got := truncateSummary("abcdef", 5); got != "ab..." {
		t.Fatalf("unexpected shortened result: %q", got)
	}
	if got := truncateSummary("abc", 0); got != "abc" {
		t.Fatalf("unexpected no-limit result: %q", got)
	}
}

func TestWaterfallPrintIncludesLLMTokens(t *testing.T) {
	tracer := &waterfallTracer{
		sessionID: "s-1",
		runStart:  time.Now().Add(-2 * time.Second),
		steps: []waterfallStep{
			{
				Kind:         "llm",
				Name:         "llm_round_1",
				DurationMs:   120,
				InputTokens:  11,
				OutputTokens: 7,
				TotalTokens:  18,
				Summary:      "hello world",
			},
			{
				Kind:       "tool",
				Name:       "file_read",
				DurationMs: 40,
				Summary:    "{\"ok\":true}",
			},
		},
	}
	var buf bytes.Buffer
	tracer.Print(&buf)
	out := buf.String()
	for _, sub := range []string{
		"[waterfall] summary",
		"[waterfall] timeline",
		"steps=2 llm=1 tool=1",
		"in=11 out=7 total=18",
		"6.0%",
		"LLM #1",
		"Tool-file_read",
		"[waterfall] total_ms=",
	} {
		if !strings.Contains(out, sub) {
			t.Fatalf("missing %q in output: %s", sub, out)
		}
	}
}

func TestSummarizeToolInput(t *testing.T) {
	raw := `{"description":"list files","command":"ls -la","path":"/tmp/x","extra":"ignored"}`
	got := summarizeToolInput(raw)
	for _, sub := range []string{`description="list files"`, `command="ls -la"`, `path="/tmp/x"`} {
		if !strings.Contains(got, sub) {
			t.Fatalf("missing %q in %q", sub, got)
		}
	}
}

func TestDecodeInputJSONChunk(t *testing.T) {
	got := decodeInputJSONChunk([]byte(`"abc"`))
	if got != "abc" {
		t.Fatalf("unexpected decoded chunk: %q", got)
	}
}
