package agent

import (
	"os"
	"path/filepath"
	"testing"
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
