package main

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"

	"github.com/cinience/alicloud-skills/internal/agent"
	"github.com/google/uuid"
)

type App struct {
	ctx       context.Context
	engine    *agent.Engine
	sessionMu sync.Mutex
	sessions  map[string]struct{}
}

type SendRequest struct {
	SessionID string `json:"sessionId"`
	Prompt    string `json:"prompt"`
}

type SendResponse struct {
	SessionID string `json:"sessionId"`
	Output    string `json:"output"`
}

func NewApp(eng *agent.Engine) *App {
	return &App{engine: eng, sessions: make(map[string]struct{})}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) shutdown(ctx context.Context) {
	if a.engine != nil {
		_ = a.engine.Close()
	}
}

func (a *App) NewSession() string {
	a.sessionMu.Lock()
	defer a.sessionMu.Unlock()
	id := uuid.NewString()
	a.sessions[id] = struct{}{}
	return id
}

func (a *App) ListSkills() []string {
	metas := a.engine.Skills()
	out := make([]string, 0, len(metas))
	for _, m := range metas {
		out = append(out, m.Name)
	}
	sort.Strings(out)
	return out
}

func (a *App) GetModel() string {
	return a.engine.ModelName()
}

func (a *App) Send(req SendRequest) (*SendResponse, error) {
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, errors.New("prompt is required")
	}
	sessionID := strings.TrimSpace(req.SessionID)
	if sessionID == "" {
		sessionID = a.NewSession()
	}

	out, err := a.engine.Run(a.ctx, sessionID, prompt)
	if err != nil {
		return nil, err
	}
	return &SendResponse{SessionID: sessionID, Output: out}, nil
}
