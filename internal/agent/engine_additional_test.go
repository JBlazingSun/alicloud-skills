package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/godeps/agentkit/pkg/model"
)

func TestNormalizedSkillsDirs(t *testing.T) {
	root := t.TempDir()
	got := normalizedSkillsDirs(root, []string{"skills", "skills", "/tmp/ext"})
	if len(got) != 2 {
		t.Fatalf("expected 2 dirs, got %v", got)
	}
	if got[0] != filepath.Join(root, "skills") {
		t.Fatalf("unexpected first dir: %s", got[0])
	}
}

func TestDiscoverSkills(t *testing.T) {
	root := t.TempDir()
	cfgRoot := filepath.Join(root, ".alicloud-skills")
	if err := os.MkdirAll(cfgRoot, 0o755); err != nil {
		t.Fatalf("mkdir cfg root: %v", err)
	}
	skillDir := filepath.Join(root, "skills", "demo")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("mkdir skills dir: %v", err)
	}
	content := "---\nname: demo\ndescription: demo skill\n---\nbody"
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(content), 0o600); err != nil {
		t.Fatalf("write skill: %v", err)
	}
	recursive := true
	metas, errs := DiscoverSkills(root, cfgRoot, []string{filepath.Join(root, "skills")}, &recursive)
	if len(errs) != 0 {
		t.Fatalf("unexpected errs: %v", errs)
	}
	if len(metas) != 1 || metas[0].Name != "demo" {
		t.Fatalf("unexpected metas: %+v", metas)
	}
	if metas[0].SkillPath == "" {
		t.Fatalf("expected skill path to be set")
	}
}

func TestModelTurnRecorderSince(t *testing.T) {
	r := newModelTurnRecorder()
	r.record("s1", ModelTurnStat{Iteration: 1, TotalTokens: 10, Timestamp: time.Now()})
	r.record("s1", ModelTurnStat{Iteration: 2, TotalTokens: 20, Timestamp: time.Now()})

	if got := r.count("s1"); got != 2 {
		t.Fatalf("unexpected count: %d", got)
	}
	items := r.since("s1", 1)
	if len(items) != 1 || items[0].Iteration != 2 {
		t.Fatalf("unexpected since result: %+v", items)
	}
}

func TestMiddlewareUsage(t *testing.T) {
	got := middlewareUsage(map[string]any{
		"model.usage": model.Usage{
			InputTokens:  3,
			OutputTokens: 4,
			TotalTokens:  7,
		},
	})
	if got.TotalTokens != 7 {
		t.Fatalf("unexpected usage: %+v", got)
	}
}

func TestMiddlewarePreviewUTF8Safe(t *testing.T) {
	longChinese := strings.Repeat("阿里云模型输出", 40)
	resp := &model.Response{}
	resp.Message.Content = longChinese
	got := middlewarePreview(resp)
	if !utf8.ValidString(got) || strings.ContainsRune(got, '�') {
		t.Fatalf("unexpected utf8 corruption: %q", got)
	}
}
