package clikit

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPackageDoesNotImportInternalAgent(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		if strings.Contains(string(b), "internal/agent") {
			t.Fatalf("%s should not import internal/agent", f)
		}
	}
}
