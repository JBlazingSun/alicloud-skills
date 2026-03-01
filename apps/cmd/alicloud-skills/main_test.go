package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestRootHelpIncludesSubcommands(t *testing.T) {
	cmd := newRootCmd()
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{"--help"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute help: %v", err)
	}
	for _, sub := range []string{"run", "repl", "skills", "config", "api"} {
		if !strings.Contains(out.String(), sub) {
			t.Fatalf("missing subcommand %q in output: %s", sub, out.String())
		}
	}
}

func TestAPICommand(t *testing.T) {
	cmd := newRootCmd()
	var buf bytes.Buffer
	cmd.SetOut(&buf)
	cmd.SetErr(&buf)
	cmd.SetArgs([]string{"api"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute api: %v", err)
	}
	out := buf.String()
	for _, sub := range []string{"not implemented", "alicloud-skills run"} {
		if !strings.Contains(out, sub) {
			t.Fatalf("missing %q in output: %s", sub, out)
		}
	}
}

func TestResolveCLIOptionsAutonomyFromEnv(t *testing.T) {
	t.Setenv("ALICLOUD_SKILLS_AUTONOMY", "aggressive")
	cmd := newRootCmd()
	got := resolveCLIOptions(cmd, cliOptions{})
	if got.autonomy != "aggressive" {
		t.Fatalf("expected aggressive autonomy, got %q", got.autonomy)
	}

	t.Setenv("ALICLOUD_SKILLS_AUTONOMY", "invalid")
	got = resolveCLIOptions(cmd, cliOptions{})
	if got.autonomy != "balanced" {
		t.Fatalf("invalid autonomy should normalize to balanced, got %q", got.autonomy)
	}
}

func TestResolveCLIOptionsAutoForcesAggressive(t *testing.T) {
	got := resolveCLIOptions(nil, cliOptions{autonomy: "conservative", auto: true})
	if got.autonomy != "aggressive" {
		t.Fatalf("--auto should force aggressive autonomy, got %q", got.autonomy)
	}
	if !got.auto {
		t.Fatalf("--auto should remain enabled")
	}
}
