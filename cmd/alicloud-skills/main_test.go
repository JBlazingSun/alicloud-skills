package main

import (
	"bytes"
	"strings"
	"testing"

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
		name    string
		args    []string
		want    string
		wantOK  bool
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
