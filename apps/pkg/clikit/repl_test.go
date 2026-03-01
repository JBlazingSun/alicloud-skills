package clikit

import (
	"io"
	"testing"

	"github.com/chzyer/readline"
)

func TestIsReadTermination(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{name: "eof", err: io.EOF, want: true},
		{name: "interrupt", err: readline.ErrInterrupt, want: true},
		{name: "nil", err: nil, want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isReadTermination(tc.err); got != tc.want {
				t.Fatalf("isReadTermination(%v)=%v want=%v", tc.err, got, tc.want)
			}
		})
	}
}
