package agent

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestResolveDefaultSkillsDirs(t *testing.T) {
	wd := t.TempDir()
	prev, _ := os.Getwd()
	if err := os.Chdir(wd); err != nil {
		t.Fatalf("chdir failed: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(prev) })

	repoRoot := "/tmp/repo"
	home := "/tmp/home"

	got := ResolveDefaultSkillsDirs(repoRoot, home)
	want := []string{
		filepath.Clean(filepath.Join(wd, "skills")),
		filepath.Clean("/tmp/repo/skills"),
		filepath.Clean("/tmp/home/.agents/skills"),
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected dirs\nwant: %#v\n got: %#v", want, got)
	}
}

func TestMatchSkill(t *testing.T) {
	metas := []SkillMeta{
		{Name: "alicloud-ai-image-qwen-image"},
		{Name: "alicloud-ai-video-wan-video"},
	}

	if got := MatchSkill("use alicloud-ai-image-qwen-image now", metas); got != "alicloud-ai-image-qwen-image" {
		t.Fatalf("expected image skill, got %q", got)
	}

	if got := MatchSkill("use alicloud-ai-image-qwen-image and alicloud-ai-video-wan-video", metas); got != "" {
		t.Fatalf("expected empty when multiple match, got %q", got)
	}

	if got := MatchSkill("nothing matches", metas); got != "" {
		t.Fatalf("expected empty when no match, got %q", got)
	}
}

func TestBuildSystemPromptContainsSkills(t *testing.T) {
	metas := []SkillMeta{
		{Name: "skill-a", Description: "desc-a"},
		{Name: "skill-b", Description: "desc-b"},
	}

	prompt := BuildSystemPrompt("base", metas)
	if prompt == "" {
		t.Fatal("expected non-empty prompt")
	}
	if !containsAll(prompt, []string{"base", "skill-a", "desc-a", "skill-b", "desc-b"}) {
		t.Fatalf("prompt missing expected fields: %s", prompt)
	}
}

func containsAll(s string, subs []string) bool {
	for _, sub := range subs {
		if !contains(s, sub) {
			return false
		}
	}
	return true
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
