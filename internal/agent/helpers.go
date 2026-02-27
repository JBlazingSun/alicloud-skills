package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type SkillMeta struct {
	Name        string
	Description string
	SkillDir    string
	SkillPath   string
}

func ResolveDefaultSkillsDirs(repoRoot, home string) []string {
	var dirs []string
	seen := map[string]struct{}{}
	add := func(dir string) {
		if dir == "" {
			return
		}
		clean := filepath.Clean(dir)
		if _, ok := seen[clean]; ok {
			return
		}
		seen[clean] = struct{}{}
		dirs = append(dirs, clean)
	}

	if wd, err := os.Getwd(); err == nil && wd != "" {
		add(filepath.Join(wd, "skills"))
	}

	add(filepath.Join(repoRoot, "skills"))
	if home != "" {
		add(filepath.Join(home, ".agents", "skills"))
	}

	return dirs
}

func MatchSkill(prompt string, metas []SkillMeta) string {
	lower := strings.ToLower(prompt)
	matched := ""
	for _, m := range metas {
		if strings.Contains(lower, strings.ToLower(m.Name)) {
			if matched != "" {
				return ""
			}
			matched = m.Name
		}
	}
	return matched
}

func BuildSystemPrompt(base string, metas []SkillMeta) string {
	lines := make([]string, 0, len(metas))
	for _, m := range metas {
		lines = append(lines, fmt.Sprintf("- **%s**: %s", m.Name, m.Description))
	}
	if len(lines) == 0 {
		return base
	}
	return base + "\n\n## Available Skills\n\n" + strings.Join(lines, "\n") + "\n"
}
