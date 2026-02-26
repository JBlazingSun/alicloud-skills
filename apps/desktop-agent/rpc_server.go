package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cinience/alicloud-skills/internal/agent"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type serverState struct {
	mu sync.RWMutex

	engine *agent.Engine

	clients map[string]*clientConn

	threads       []thread
	threadByID    map[string]thread
	threadItems   map[string][]threadItem
	threadCursors map[string]int64
	threadSession map[string]string
	sessionThread map[string]string
	loadedThreads map[string]bool
	pendingByID   map[string]*pendingApproval

	subscribers map[string]map[string]struct{}

	ownerByThread map[string]string
	ttlByThread   map[string]int64

	settings map[string]any
	config   string

	workspaces      []workspaceInfo
	activeWorkspace string
	threadProjects  map[string]string
	recentPaths     []string
	favoritePaths   []string
}

type workspaceInfo struct {
	ID     string `json:"id"`
	Path   string `json:"path"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
	Exists bool   `json:"exists"`
}

type clientConn struct {
	id   string
	conn *websocket.Conn
	send chan any
}

type pendingApproval struct {
	ID        string
	ThreadID  string
	Method    string
	CreatedAt time.Time
	Reason    string
	ToolName  string
	Command   string
	Cwd       string
	ResultCh  chan approvalDecision
}

type approvalDecision struct {
	Decision string
}

type persistedState struct {
	Version         int                     `json:"version"`
	Threads         []thread                `json:"threads"`
	ThreadItems     map[string][]threadItem `json:"threadItems,omitempty"`   // legacy migration
	ThreadCursors   map[string]int64        `json:"threadCursors,omitempty"` // legacy migration
	ThreadSession   map[string]string       `json:"threadSession"`
	LoadedThreads   []string                `json:"loadedThreads"`
	Settings        map[string]any          `json:"settings"`
	Workspaces      []workspaceInfo         `json:"workspaces"`
	ActiveWorkspace string                  `json:"activeWorkspace"`
	ThreadProjects  map[string]string       `json:"threadProjects"`
	RecentPaths     []string                `json:"recentPaths"`
	FavoritePaths   []string                `json:"favoritePaths"`
}

type persistedSession struct {
	Version   int          `json:"version"`
	Thread    thread       `json:"thread"`
	SessionID string       `json:"sessionId"`
	Cursor    int64        `json:"cursor"`
	Items     []threadItem `json:"items"`
}

type rpcServer struct {
	addr        string
	dataDir     string
	configPath  string
	statePath   string
	sessionsDir string
	state       *serverState
	persistMu   sync.Mutex
	httpSrv     *http.Server
	upgrader    websocket.Upgrader
}

func newRPCServer(addr string, eng *agent.Engine, repoRoot string) *rpcServer {
	dataDir := resolveDataDir()
	cfgPath := filepath.Join(dataDir, "config.toml")
	statePath := filepath.Join(dataDir, "state.json")
	sessionsDir := filepath.Join(dataDir, "sessions")
	_ = os.MkdirAll(dataDir, 0o755)
	_ = os.MkdirAll(sessionsDir, 0o755)
	cfgBytes, _ := os.ReadFile(cfgPath)
	if len(cfgBytes) == 0 {
		legacyCfg := filepath.Join(repoRoot, "output", "desktop", "config.toml")
		if legacyBytes, err := os.ReadFile(legacyCfg); err == nil && len(legacyBytes) > 0 {
			cfgBytes = legacyBytes
			_ = os.WriteFile(cfgPath, legacyBytes, 0o644)
		}
	}

	st := &serverState{
		engine:        eng,
		clients:       map[string]*clientConn{},
		threadByID:    map[string]thread{},
		threadItems:   map[string][]threadItem{},
		threadCursors: map[string]int64{},
		threadSession: map[string]string{},
		sessionThread: map[string]string{},
		loadedThreads: map[string]bool{},
		pendingByID:   map[string]*pendingApproval{},
		subscribers:   map[string]map[string]struct{}{},
		ownerByThread: map[string]string{},
		ttlByThread:   map[string]int64{},
		settings: map[string]any{
			"version":    1,
			"automation": map[string]any{"auto_subscribe": true, "auto_claim": true, "auto_renew": true},
		},
		config:         string(cfgBytes),
		threadProjects: map[string]string{},
	}
	st.workspaces = discoverInitialWorkspaces(repoRoot)
	if len(st.workspaces) > 0 {
		st.activeWorkspace = st.workspaces[0].Path
		st.workspaces[0].Active = true
	}
	loadPersistedState(statePath, sessionsDir, st)

	s := &rpcServer{
		addr:        addr,
		dataDir:     dataDir,
		configPath:  cfgPath,
		statePath:   statePath,
		sessionsDir: sessionsDir,
		state:       st,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
	eng.SetPermissionHandler(s.onPermissionRequest)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWS)
	s.httpSrv = &http.Server{Addr: addr, Handler: mux}
	return s
}

func (s *rpcServer) start() error {
	go func() {
		_ = s.httpSrv.ListenAndServe()
	}()
	go s.expireRoomOwners()
	return nil
}

func (s *rpcServer) stop(ctx context.Context) error {
	return s.httpSrv.Shutdown(ctx)
}

func (s *rpcServer) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := &clientConn{id: uuid.NewString(), conn: conn, send: make(chan any, 128)}

	s.state.mu.Lock()
	s.state.clients[client.id] = client
	s.state.mu.Unlock()

	go s.writer(client)
	s.reader(client)
}

func (s *rpcServer) writer(c *clientConn) {
	for msg := range c.send {
		_ = c.conn.WriteJSON(msg)
	}
	_ = c.conn.Close()
}

func (s *rpcServer) reader(c *clientConn) {
	defer func() {
		s.state.mu.Lock()
		delete(s.state.clients, c.id)
		for _, subs := range s.state.subscribers {
			delete(subs, c.id)
		}
		s.state.mu.Unlock()
		close(c.send)
		_ = c.conn.Close()
	}()

	for {
		var req rpcRequest
		if err := c.conn.ReadJSON(&req); err != nil {
			return
		}
		if req.Method == "" {
			continue
		}
		result, rpcErr := s.handleMethod(c.id, req.Method, req.Params)
		if req.ID != nil {
			resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
			if rpcErr != nil {
				resp.Error = rpcErr
			} else {
				resp.Result = result
			}
			c.send <- resp
		}
	}
}

func (s *rpcServer) notifyClient(clientID, method string, params any) {
	s.state.mu.RLock()
	c := s.state.clients[clientID]
	s.state.mu.RUnlock()
	if c == nil {
		return
	}
	select {
	case c.send <- rpcNotification{JSONRPC: "2.0", Method: method, Params: params}:
	default:
	}
}

func (s *rpcServer) notifySubscribers(threadID, method string, params any) {
	s.state.mu.RLock()
	subs := s.state.subscribers[threadID]
	ids := make([]string, 0, len(subs))
	for id := range subs {
		ids = append(ids, id)
	}
	s.state.mu.RUnlock()
	for _, id := range ids {
		s.notifyClient(id, method, params)
	}
}

func rpcErr(code int, msg string, data any) *rpcError {
	return &rpcError{Code: code, Message: msg, Data: data}
}

func (s *rpcServer) handleMethod(clientID, method string, params map[string]any) (any, *rpcError) {
	switch method {
	case "initialize":
		return map[string]any{"clientId": clientID}, nil
	case "skill/list":
		metas := s.state.engine.Skills()
		skills := make([]map[string]any, 0, len(metas))
		for _, m := range metas {
			skills = append(skills, map[string]any{"name": m.Name, "description": m.Description, "path": filepath.Join(m.SkillDir, m.Name)})
		}
		return map[string]any{"skills": skills}, nil
	case "settings/get":
		s.state.mu.RLock()
		defer s.state.mu.RUnlock()
		return s.state.settings, nil
	case "settings/set":
		settings := asMap(params["settings"])
		if settings == nil {
			return nil, rpcErr(-32602, "settings is required", nil)
		}
		s.state.mu.Lock()
		s.state.settings = settings
		s.state.mu.Unlock()
		s.persistState()
		return settings, nil
	case "config/get":
		s.state.mu.RLock()
		cfg := s.state.config
		s.state.mu.RUnlock()
		return map[string]any{"path": s.configPath, "content": cfg}, nil
	case "config/set":
		content := asString(params["content"])
		s.state.mu.Lock()
		s.state.config = content
		s.state.mu.Unlock()
		_ = os.MkdirAll(s.dataDir, 0o755)
		_ = os.WriteFile(s.configPath, []byte(content), 0o644)
		return map[string]any{"ok": true}, nil
	case "thread/list", "thread/loaded/list":
		return s.listThreads(params, method == "thread/loaded/list"), nil
	case "thread/start":
		return s.startThread(), nil
	case "room/subscribe":
		threadID := asString(params["threadId"])
		if threadID == "" {
			return nil, rpcErr(-32602, "threadId is required", nil)
		}
		return s.subscribeRoom(clientID, threadID), nil
	case "room/unsubscribe":
		threadID := asString(params["threadId"])
		s.unsubscribeRoom(clientID, threadID)
		return map[string]any{"ok": true}, nil
	case "room/claim":
		threadID := asString(params["threadId"])
		if threadID == "" {
			return nil, rpcErr(-32602, "threadId is required", nil)
		}
		return s.claimRoom(clientID, threadID), nil
	case "room/release":
		threadID := asString(params["threadId"])
		return s.releaseRoom(clientID, threadID), nil
	case "turn/start", "conversation/sendMessage":
		return s.startTurn(clientID, method, params)
	case "codex/request/respond":
		return s.respondApproval(params)
	case "workspace/list":
		return s.workspaceList(), nil
	case "workspace/browse":
		return s.workspaceBrowse(params)
	case "workspace/add":
		return s.workspaceAdd(asString(params["path"]))
	case "workspace/remove":
		return s.workspaceRemove(asString(params["path"]))
	case "workspace/activate":
		return s.workspaceActivate(asString(params["path"]))
	case "workspace/thread/get":
		return s.workspaceThreadGet(asString(params["threadId"])), nil
	case "workspace/thread/set":
		return s.workspaceThreadSet(asString(params["threadId"]), nullToString(params["path"]))
	case "workspace/preferences/get":
		return s.workspacePrefs(), nil
	case "workspace/preferences/touch":
		return s.workspaceTouchRecent(asString(params["path"]))
	case "workspace/preferences/toggleFavorite":
		return s.workspaceToggleFavorite(asString(params["path"]))
	case "workspace/worktree/list":
		return s.worktreeList(nullToString(params["path"]))
	case "workspace/worktree/create":
		return s.worktreeCreate(asString(params["sourcePath"]), asString(params["branch"]), nullToString(params["targetPath"]))
	case "workspace/worktree/remove":
		force := true
		if b, ok := params["force"].(bool); ok {
			force = b
		}
		return s.worktreeRemove(asString(params["sourcePath"]), asString(params["path"]), force)
	default:
		return nil, rpcErr(-32601, "method not found: "+method, nil)
	}
}

func (s *rpcServer) listThreads(params map[string]any, loadedOnly bool) map[string]any {
	s.state.mu.RLock()
	threads := append([]thread(nil), s.state.threads...)
	loaded := map[string]bool{}
	for id, ok := range s.state.loadedThreads {
		loaded[id] = ok
	}
	s.state.mu.RUnlock()
	if loadedOnly {
		filtered := make([]thread, 0, len(threads))
		for _, t := range threads {
			if loaded[t.ID] {
				filtered = append(filtered, t)
			}
		}
		threads = filtered
	}
	sort.SliceStable(threads, func(i, j int) bool { return threads[i].CreatedAt > threads[j].CreatedAt })

	start := 0
	if cur := asString(params["cursor"]); cur != "" {
		if n, err := strconv.Atoi(cur); err == nil && n >= 0 && n <= len(threads) {
			start = n
		}
	}
	limit := 50
	end := start + limit
	if end > len(threads) {
		end = len(threads)
	}
	next := ""
	if end < len(threads) {
		next = strconv.Itoa(end)
	}
	items := make([]map[string]any, 0, end-start)
	for _, t := range threads[start:end] {
		items = append(items, map[string]any{"id": t.ID, "title": t.Title, "createdAt": t.CreatedAt})
	}
	return map[string]any{"threads": items, "nextCursor": next}
}

func (s *rpcServer) startThread() map[string]any {
	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.NewString()
	th := thread{ID: id, Title: "Thread " + id[:8], CreatedAt: now}

	s.state.mu.Lock()
	s.state.threads = append([]thread{th}, s.state.threads...)
	s.state.threadByID[id] = th
	s.state.threadItems[id] = []threadItem{}
	s.state.threadCursors[id] = 0
	sessionID := uuid.NewString()
	s.state.threadSession[id] = sessionID
	s.state.sessionThread[sessionID] = id
	s.state.loadedThreads[id] = true
	s.state.mu.Unlock()
	s.persistState()

	return map[string]any{"threadId": id, "thread": th}
}

func (s *rpcServer) subscribeRoom(clientID, threadID string) map[string]any {
	s.state.mu.Lock()
	if _, ok := s.state.threadByID[threadID]; !ok {
		th := thread{ID: threadID, Title: "Thread " + threadID[:8], CreatedAt: time.Now().UTC().Format(time.RFC3339)}
		s.state.threadByID[threadID] = th
		s.state.threads = append([]thread{th}, s.state.threads...)
		if _, exists := s.state.threadSession[threadID]; !exists {
			sessionID := uuid.NewString()
			s.state.threadSession[threadID] = sessionID
			s.state.sessionThread[sessionID] = threadID
		}
	}
	s.state.loadedThreads[threadID] = true
	if s.state.subscribers[threadID] == nil {
		s.state.subscribers[threadID] = map[string]struct{}{}
	}
	s.state.subscribers[threadID][clientID] = struct{}{}
	items := append([]threadItem(nil), s.state.threadItems[threadID]...)
	cursor := s.state.threadCursors[threadID]
	owner := s.state.ownerByThread[threadID]
	ttl := s.state.ttlByThread[threadID]
	if exp := ttl; exp > 0 {
		remain := exp - time.Now().UnixMilli()
		if remain < 0 {
			remain = 0
		}
		ttl = remain
	}
	s.state.mu.Unlock()

	if ttl <= 0 {
		ttl = 30000
	}
	s.persistState()
	return map[string]any{"snapshot": items, "cursor": cursor, "ownerClientId": emptyToNil(owner), "ttlMs": ttl}
}

func (s *rpcServer) unsubscribeRoom(clientID, threadID string) {
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	if subs := s.state.subscribers[threadID]; subs != nil {
		delete(subs, clientID)
	}
}

func (s *rpcServer) claimRoom(clientID, threadID string) map[string]any {
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	s.state.ownerByThread[threadID] = clientID
	ttl := int64(30000)
	s.state.ttlByThread[threadID] = time.Now().UnixMilli() + ttl
	go s.notifySubscribers(threadID, "room/owner", map[string]any{"ownerClientId": clientID, "ttlMs": ttl})
	return map[string]any{"ownerClientId": clientID, "ttlMs": ttl}
}

func (s *rpcServer) releaseRoom(clientID, threadID string) map[string]any {
	s.state.mu.Lock()
	owner := s.state.ownerByThread[threadID]
	if owner == clientID {
		delete(s.state.ownerByThread, threadID)
		delete(s.state.ttlByThread, threadID)
		owner = ""
	}
	s.state.mu.Unlock()
	go s.notifySubscribers(threadID, "room/owner", map[string]any{"ownerClientId": emptyToNil(owner), "ttlMs": 0})
	return map[string]any{"ownerClientId": emptyToNil(owner)}
}

func (s *rpcServer) startTurn(clientID, method string, params map[string]any) (any, *rpcError) {
	var threadID, text, cwd string
	if method == "conversation/sendMessage" {
		threadID = asString(params["conversation_id"])
		text = asString(params["input"])
		cwd = asString(params["cwd"])
	} else {
		threadID = asString(params["threadId"])
		cwd = asString(params["cwd"])
		if arr, ok := params["content"].([]any); ok && len(arr) > 0 {
			part := asMap(arr[0])
			text = asString(part["text"])
		}
	}
	if threadID == "" || strings.TrimSpace(text) == "" {
		return nil, rpcErr(-32602, "threadId/content is required", nil)
	}

	s.state.mu.RLock()
	owner := s.state.ownerByThread[threadID]
	s.state.mu.RUnlock()
	if owner != "" && owner != clientID {
		return nil, rpcErr(-32001, "room is owned by another client", map[string]any{"ownerClientId": owner})
	}

	if owner == "" {
		s.claimRoom(clientID, threadID)
	}

	turnID := "turn-" + uuid.NewString()
	userItem := s.appendItem(threadID, "user", text, turnID, nil)
	s.notifySubscribers(threadID, "room/event", map[string]any{"item": userItem, "cursor": userItem.Cursor})
	s.notifySubscribers(threadID, "turn/started", map[string]any{"threadId": threadID, "turnId": turnID})

	go s.runAssistantTurn(threadID, turnID, text, cwd)
	return map[string]any{"ok": true}, nil
}

func (s *rpcServer) runAssistantTurn(threadID, turnID, prompt, cwd string) {
	s.state.mu.RLock()
	sessionID := s.state.threadSession[threadID]
	eng := s.state.engine
	s.state.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	if cwd == "" {
		cwd = s.workspacePathForThread(threadID)
	}
	text := prompt
	if cwd != "" {
		text = fmt.Sprintf("[cwd=%s]\n%s", cwd, prompt)
	}

	ch, err := eng.RunStream(ctx, sessionID, text)
	if err != nil {
		s.notifySubscribers(threadID, "error", map[string]any{"message": err.Error()})
		s.notifySubscribers(threadID, "turn/finished", map[string]any{"threadId": threadID, "turn": map[string]any{"id": turnID, "status": "error", "error": map[string]any{"message": err.Error()}}})
		return
	}

	assistantID := "msg-" + uuid.NewString()
	var buf strings.Builder
	toolArgsByIndex := map[int]*strings.Builder{}
	for evt := range ch {
		switch evt.Type {
		case "content_block_delta":
			if evt.Delta != nil {
				if evt.Delta.Type == "text_delta" && evt.Delta.Text != "" {
					delta := evt.Delta.Text
					buf.WriteString(delta)
					s.notifySubscribers(threadID, "agent/message/delta", map[string]any{"itemId": assistantID, "delta": delta})
				}
				if evt.Delta.Type == "input_json_delta" && len(evt.Delta.PartialJSON) > 0 && evt.Index != nil {
					b := toolArgsByIndex[*evt.Index]
					if b == nil {
						b = &strings.Builder{}
						toolArgsByIndex[*evt.Index] = b
					}
					b.Write(evt.Delta.PartialJSON)
				}
			}
		case "content_block_start":
			if evt.ContentBlock != nil && evt.ContentBlock.Type == "tool_use" {
				payload := map[string]any{
					"type":      "commandExecution",
					"toolUseId": evt.ContentBlock.ID,
					"name":      evt.ContentBlock.Name,
					"status":    "start",
				}
				if evt.Index != nil {
					payload["index"] = *evt.Index
				}
				s.emitRoomEvent(threadID, turnID, "assistant", fmt.Sprintf("Tool start: %s", evt.ContentBlock.Name), payload)
			}
		case "tool_execution_start":
			payload := map[string]any{"type": "commandExecution", "toolUseId": evt.ToolUseID, "name": evt.Name, "status": "running"}
			s.emitRoomEvent(threadID, turnID, "assistant", fmt.Sprintf("Running tool: %s", evt.Name), payload)
		case "tool_execution_output":
			payload := map[string]any{
				"type":      "commandExecution",
				"toolUseId": evt.ToolUseID,
				"name":      evt.Name,
				"status":    "output",
				"output":    evt.Output,
				"isError":   evt.IsError != nil && *evt.IsError,
				"isStderr":  evt.IsStderr != nil && *evt.IsStderr,
			}
			s.emitRoomEvent(threadID, turnID, "assistant", stringifyOutput(evt.Output), payload)
		case "tool_execution_result":
			payload := map[string]any{"type": "toolResult", "toolUseId": evt.ToolUseID, "name": evt.Name, "result": evt.Output}
			s.emitRoomEvent(threadID, turnID, "assistant", fmt.Sprintf("Tool result: %s", evt.Name), payload)
		case "error":
			if evt.Output != nil {
				errText := fmt.Sprintf("%v", evt.Output)
				s.notifySubscribers(threadID, "error", map[string]any{"message": errText})
			}
		}
	}

	content := strings.TrimSpace(buf.String())
	if content == "" {
		content = "(empty response)"
	}
	assistantItem := s.appendItemWithID(threadID, assistantID, "assistant", content, turnID, nil)
	s.notifySubscribers(threadID, "room/event", map[string]any{"item": assistantItem, "cursor": assistantItem.Cursor})
	s.notifySubscribers(threadID, "turn/finished", map[string]any{"threadId": threadID, "turn": map[string]any{"id": turnID, "status": "completed"}})
}

func (s *rpcServer) appendItem(threadID, role, content, turnID string, raw any) threadItem {
	return s.appendItemWithID(threadID, "msg-"+uuid.NewString(), role, content, turnID, raw)
}

func (s *rpcServer) appendItemWithID(threadID, id, role, content, turnID string, raw any) threadItem {
	now := time.Now().UTC().Format(time.RFC3339)
	s.state.mu.Lock()
	cursor := s.state.threadCursors[threadID] + 1
	s.state.threadCursors[threadID] = cursor
	item := threadItem{ID: id, ThreadID: threadID, Role: role, Content: content, CreatedAt: now, Cursor: cursor, TurnID: turnID, Raw: raw}
	s.state.threadItems[threadID] = append(s.state.threadItems[threadID], item)
	s.state.loadedThreads[threadID] = true
	s.state.mu.Unlock()
	s.persistState()
	return item
}

func (s *rpcServer) workspacePathForThread(threadID string) string {
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	if p := s.state.threadProjects[threadID]; p != "" {
		return p
	}
	return s.state.activeWorkspace
}

func (s *rpcServer) workspaceList() map[string]any {
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	return map[string]any{
		"workspaces":     append([]workspaceInfo(nil), s.state.workspaces...),
		"activePath":     emptyToNil(s.state.activeWorkspace),
		"threadProjects": s.state.threadProjects,
		"recentPaths":    append([]string(nil), s.state.recentPaths...),
		"favoritePaths":  append([]string(nil), s.state.favoritePaths...),
	}
}

func (s *rpcServer) workspaceAdd(path string) (map[string]any, *rpcError) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, rpcErr(-32602, "path is required", nil)
	}
	abs := absPath(path)
	st, err := os.Stat(abs)
	exists := err == nil && st.IsDir()

	s.state.mu.Lock()
	for _, w := range s.state.workspaces {
		if w.Path == abs {
			res := s.workspaceListLocked()
			s.state.mu.Unlock()
			return res, nil
		}
	}
	s.state.workspaces = append(s.state.workspaces, workspaceInfo{ID: abs, Path: abs, Name: filepath.Base(abs), Active: false, Exists: exists})
	res := s.workspaceListLocked()
	s.state.mu.Unlock()
	s.persistState()
	return res, nil
}

func (s *rpcServer) workspaceRemove(path string) (map[string]any, *rpcError) {
	path = absPath(path)
	s.state.mu.Lock()
	out := s.state.workspaces[:0]
	for _, w := range s.state.workspaces {
		if w.Path != path {
			out = append(out, w)
		}
	}
	s.state.workspaces = out
	if s.state.activeWorkspace == path {
		s.state.activeWorkspace = ""
	}
	for k, v := range s.state.threadProjects {
		if v == path {
			delete(s.state.threadProjects, k)
		}
	}
	res := s.workspaceListLocked()
	s.state.mu.Unlock()
	s.persistState()
	return res, nil
}

func (s *rpcServer) workspaceActivate(path string) (map[string]any, *rpcError) {
	path = absPath(path)
	s.state.mu.Lock()
	s.state.activeWorkspace = path
	for i := range s.state.workspaces {
		s.state.workspaces[i].Active = s.state.workspaces[i].Path == path
	}
	if !containsString(s.state.recentPaths, path) {
		s.state.recentPaths = append([]string{path}, s.state.recentPaths...)
	}
	res := s.workspaceListLocked()
	s.state.mu.Unlock()
	s.persistState()
	return res, nil
}

func (s *rpcServer) workspaceThreadGet(threadID string) map[string]any {
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	return map[string]any{"threadId": threadID, "workspacePath": emptyToNil(s.state.threadProjects[threadID]), "threadProjects": s.state.threadProjects, "recentPaths": s.state.recentPaths}
}

func (s *rpcServer) workspaceThreadSet(threadID, path string) (map[string]any, *rpcError) {
	if threadID == "" {
		return nil, rpcErr(-32602, "threadId is required", nil)
	}
	if path != "" {
		path = absPath(path)
	}
	s.state.mu.Lock()
	if path == "" {
		delete(s.state.threadProjects, threadID)
	} else {
		s.state.threadProjects[threadID] = path
		s.state.recentPaths = touchRecent(s.state.recentPaths, path)
	}
	res := map[string]any{"threadId": threadID, "workspacePath": emptyToNil(path), "threadProjects": s.state.threadProjects, "recentPaths": s.state.recentPaths}
	s.state.mu.Unlock()
	s.persistState()
	return res, nil
}

func (s *rpcServer) workspacePrefs() map[string]any {
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	return map[string]any{"recentPaths": append([]string(nil), s.state.recentPaths...), "favoritePaths": append([]string(nil), s.state.favoritePaths...)}
}

func (s *rpcServer) workspaceTouchRecent(path string) (map[string]any, *rpcError) {
	path = absPath(path)
	s.state.mu.Lock()
	s.state.recentPaths = touchRecent(s.state.recentPaths, path)
	res := map[string]any{"recentPaths": append([]string(nil), s.state.recentPaths...), "favoritePaths": append([]string(nil), s.state.favoritePaths...)}
	s.state.mu.Unlock()
	s.persistState()
	return res, nil
}

func (s *rpcServer) workspaceToggleFavorite(path string) (map[string]any, *rpcError) {
	path = absPath(path)
	s.state.mu.Lock()
	if containsString(s.state.favoritePaths, path) {
		s.state.favoritePaths = removeString(s.state.favoritePaths, path)
	} else {
		s.state.favoritePaths = append(s.state.favoritePaths, path)
	}
	res := map[string]any{"recentPaths": append([]string(nil), s.state.recentPaths...), "favoritePaths": append([]string(nil), s.state.favoritePaths...)}
	s.state.mu.Unlock()
	s.persistState()
	return res, nil
}

func (s *rpcServer) workspaceBrowse(params map[string]any) (map[string]any, *rpcError) {
	path := asString(params["path"])
	search := strings.ToLower(strings.TrimSpace(asString(params["search"])))
	limit := 100
	if n, ok := asInt(params["limit"]); ok && n > 0 && n <= 500 {
		limit = n
	}
	cursor := 0
	if n, ok := asInt(params["cursor"]); ok && n >= 0 {
		cursor = n
	}
	if path == "" {
		if wd, err := os.Getwd(); err == nil {
			path = wd
		}
	}
	path = absPath(path)

	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, rpcErr(-32000, err.Error(), nil)
	}
	dirs := make([]map[string]any, 0)
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		if search != "" && !strings.Contains(strings.ToLower(name), search) {
			continue
		}
		dirs = append(dirs, map[string]any{"name": name, "path": filepath.Join(path, name)})
	}
	sort.Slice(dirs, func(i, j int) bool { return asString(dirs[i]["name"]) < asString(dirs[j]["name"]) })
	end := cursor + limit
	if end > len(dirs) {
		end = len(dirs)
	}
	next := any(nil)
	if end < len(dirs) {
		next = end
	}
	parent := any(nil)
	if p := filepath.Dir(path); p != path {
		parent = p
	}
	return map[string]any{"currentPath": path, "parentPath": parent, "directories": dirs[cursor:end], "nextCursor": next, "limit": limit}, nil
}

func (s *rpcServer) worktreeList(path string) (map[string]any, *rpcError) {
	if path == "" {
		path = s.state.activeWorkspace
	}
	if path == "" {
		return map[string]any{"workspacePath": "", "worktrees": []any{}}, nil
	}
	path = absPath(path)
	out, err := runGit(path, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, rpcErr(-32000, err.Error(), nil)
	}
	items := parseWorktreeList(out, path)
	return map[string]any{"workspacePath": path, "worktrees": items}, nil
}

func (s *rpcServer) worktreeCreate(sourcePath, branch, targetPath string) (map[string]any, *rpcError) {
	sourcePath = absPath(sourcePath)
	if sourcePath == "" || strings.TrimSpace(branch) == "" {
		return nil, rpcErr(-32602, "sourcePath and branch are required", nil)
	}
	if targetPath == "" {
		targetPath = filepath.Join(filepath.Dir(sourcePath), filepath.Base(sourcePath)+"-"+branch)
	}
	targetPath = absPath(targetPath)
	_, err := runGit(sourcePath, "worktree", "add", "-b", branch, targetPath)
	if err != nil {
		return nil, rpcErr(-32000, err.Error(), nil)
	}
	list, e := s.worktreeList(sourcePath)
	if e != nil {
		return nil, e
	}
	snap, _ := s.workspaceActivate(targetPath)
	return map[string]any{"createdPath": targetPath, "activePath": targetPath, "workspaces": snap["workspaces"], "threadProjects": snap["threadProjects"], "recentPaths": snap["recentPaths"], "favoritePaths": snap["favoritePaths"], "worktrees": list["worktrees"]}, nil
}

func (s *rpcServer) worktreeRemove(sourcePath, path string, force bool) (map[string]any, *rpcError) {
	sourcePath = absPath(sourcePath)
	path = absPath(path)
	if sourcePath == "" || path == "" {
		return nil, rpcErr(-32602, "sourcePath and path are required", nil)
	}
	args := []string{"worktree", "remove"}
	if force {
		args = append(args, "--force")
	}
	args = append(args, path)
	_, err := runGit(sourcePath, args...)
	if err != nil {
		return nil, rpcErr(-32000, err.Error(), nil)
	}
	list, e := s.worktreeList(sourcePath)
	if e != nil {
		return nil, e
	}
	snap, _ := s.workspaceList(), (*rpcError)(nil)
	return map[string]any{"activePath": snap["activePath"], "workspaces": snap["workspaces"], "threadProjects": snap["threadProjects"], "recentPaths": snap["recentPaths"], "favoritePaths": snap["favoritePaths"], "worktrees": list["worktrees"]}, nil
}

func (s *rpcServer) workspaceListLocked() map[string]any {
	return map[string]any{
		"workspaces":     append([]workspaceInfo(nil), s.state.workspaces...),
		"activePath":     emptyToNil(s.state.activeWorkspace),
		"threadProjects": s.state.threadProjects,
		"recentPaths":    append([]string(nil), s.state.recentPaths...),
		"favoritePaths":  append([]string(nil), s.state.favoritePaths...),
	}
}

func (s *rpcServer) emitRoomEvent(threadID, turnID, role, content string, raw any) {
	item := s.appendItem(threadID, role, content, turnID, raw)
	s.notifySubscribers(threadID, "room/event", map[string]any{"item": item, "cursor": item.Cursor})
}

func (s *rpcServer) respondApproval(params map[string]any) (any, *rpcError) {
	requestID := strings.TrimSpace(fmt.Sprintf("%v", params["requestId"]))
	if requestID == "" {
		return nil, rpcErr(-32602, "requestId is required", nil)
	}
	result := asMap(params["result"])
	decision := parseApprovalDecision(result)
	if decision == "" {
		return nil, rpcErr(-32602, "result.decision is required", nil)
	}
	s.state.mu.Lock()
	p := s.state.pendingByID[requestID]
	if p != nil {
		delete(s.state.pendingByID, requestID)
	}
	s.state.mu.Unlock()
	if p == nil {
		return nil, rpcErr(-32004, "approval request not found", nil)
	}
	select {
	case p.ResultCh <- approvalDecision{Decision: decision}:
	default:
	}
	status := "answered"
	s.notifySubscribers(p.ThreadID, "codex/request/resolved", map[string]any{
		"requestId": requestID,
		"method":    p.Method,
		"status":    status,
	})
	return map[string]any{"ok": true}, nil
}

func parseApprovalDecision(result map[string]any) string {
	if result == nil {
		return ""
	}
	d := strings.ToLower(asString(result["decision"]))
	switch d {
	case "approved", "allow", "accept", "acceptforsession":
		return "approved"
	case "approved_for_session":
		return "approved_for_session"
	case "deny", "denied", "decline", "abort", "cancel":
		return "denied"
	default:
		return ""
	}
}

func (s *rpcServer) onPermissionRequest(ctx context.Context, req agent.PermissionRequest) (agent.PermissionDecision, error) {
	threadID := ""
	s.state.mu.RLock()
	if v := s.state.sessionThread[req.SessionID]; v != "" {
		threadID = v
	}
	s.state.mu.RUnlock()
	if threadID == "" {
		return agent.PermissionDeny, nil
	}

	requestID := "req-" + uuid.NewString()
	method := "execCommandApproval"
	toolName := strings.TrimSpace(req.ToolName)
	if strings.EqualFold(toolName, "apply_patch") || strings.Contains(strings.ToLower(toolName), "patch") {
		method = "applyPatchApproval"
	}
	command := toolName
	if req.Target != "" {
		command = fmt.Sprintf("%s %s", toolName, req.Target)
	}
	p := &pendingApproval{
		ID:        requestID,
		ThreadID:  threadID,
		Method:    method,
		CreatedAt: time.Now(),
		Reason:    req.Reason,
		ToolName:  req.ToolName,
		Command:   command,
		Cwd:       s.workspacePathForThread(threadID),
		ResultCh:  make(chan approvalDecision, 1),
	}

	s.state.mu.Lock()
	s.state.pendingByID[requestID] = p
	s.state.mu.Unlock()

	s.notifySubscribers(threadID, "codex/request", map[string]any{
		"requestId": requestID,
		"method":    method,
		"params": map[string]any{
			"threadId": threadID,
			"command":  command,
			"cwd":      p.Cwd,
			"reason":   req.Reason,
			"toolName": req.ToolName,
			"target":   req.Target,
		},
	})

	timer := time.NewTimer(120 * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		s.state.mu.Lock()
		delete(s.state.pendingByID, requestID)
		s.state.mu.Unlock()
		s.notifySubscribers(threadID, "codex/request/resolved", map[string]any{
			"requestId": requestID,
			"method":    method,
			"status":    "timeout",
			"reason":    "context canceled",
		})
		return agent.PermissionDeny, nil
	case <-timer.C:
		s.state.mu.Lock()
		delete(s.state.pendingByID, requestID)
		s.state.mu.Unlock()
		s.notifySubscribers(threadID, "codex/request/resolved", map[string]any{
			"requestId": requestID,
			"method":    method,
			"status":    "timeout",
			"reason":    "approval timeout",
		})
		return agent.PermissionDeny, nil
	case res := <-p.ResultCh:
		if res.Decision == "approved" || res.Decision == "approved_for_session" {
			return agent.PermissionAllow, nil
		}
		return agent.PermissionDeny, nil
	}
}

func (s *rpcServer) expireRoomOwners() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now().UnixMilli()
		updates := make(map[string]any)
		s.state.mu.Lock()
		for threadID, exp := range s.state.ttlByThread {
			if exp <= 0 || exp > now {
				continue
			}
			delete(s.state.ttlByThread, threadID)
			delete(s.state.ownerByThread, threadID)
			updates[threadID] = map[string]any{"ownerClientId": nil, "ttlMs": int64(0)}
		}
		s.state.mu.Unlock()
		for threadID, payload := range updates {
			s.notifySubscribers(threadID, "room/owner", payload)
		}
	}
}

func (s *rpcServer) persistState() {
	s.persistMu.Lock()
	defer s.persistMu.Unlock()

	s.state.mu.RLock()
	ps := persistedState{
		Version:         1,
		Threads:         append([]thread(nil), s.state.threads...),
		ThreadSession:   copyStringMap(s.state.threadSession),
		LoadedThreads:   loadedThreadIDs(s.state.loadedThreads),
		Settings:        cloneMapAny(s.state.settings),
		Workspaces:      append([]workspaceInfo(nil), s.state.workspaces...),
		ActiveWorkspace: s.state.activeWorkspace,
		ThreadProjects:  copyStringMap(s.state.threadProjects),
		RecentPaths:     append([]string(nil), s.state.recentPaths...),
		FavoritePaths:   append([]string(nil), s.state.favoritePaths...),
	}
	threadItems := copyThreadItems(s.state.threadItems)
	threadCursors := copyInt64Map(s.state.threadCursors)
	threadByID := make(map[string]thread, len(s.state.threadByID))
	for k, v := range s.state.threadByID {
		threadByID[k] = v
	}
	s.state.mu.RUnlock()

	data, err := json.MarshalIndent(ps, "", "  ")
	if err != nil {
		return
	}
	tmp := s.statePath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, s.statePath)

	_ = os.MkdirAll(s.sessionsDir, 0o755)
	live := map[string]struct{}{}
	for threadID, items := range threadItems {
		fileID := sanitizeSessionFilename(threadID)
		live[fileID] = struct{}{}
		th := threadByID[threadID]
		if th.ID == "" {
			th = thread{ID: threadID, Title: "Thread " + shortID(threadID)}
		}
		sessionID := ps.ThreadSession[threadID]
		session := persistedSession{
			Version:   1,
			Thread:    th,
			SessionID: sessionID,
			Cursor:    threadCursors[threadID],
			Items:     append([]threadItem(nil), items...),
		}
		if b, err := json.MarshalIndent(session, "", "  "); err == nil {
			p := filepath.Join(s.sessionsDir, fileID+".json")
			_ = os.WriteFile(p+".tmp", b, 0o644)
			_ = os.Rename(p+".tmp", p)
		}
	}
	entries, err := os.ReadDir(s.sessionsDir)
	if err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
				continue
			}
			id := strings.TrimSuffix(e.Name(), ".json")
			if _, ok := live[id]; ok {
				continue
			}
			_ = os.Remove(filepath.Join(s.sessionsDir, e.Name()))
		}
	}
}

func loadPersistedState(statePath, sessionsDir string, st *serverState) {
	data, err := os.ReadFile(statePath)
	if err != nil || len(data) == 0 {
		loadPersistedSessions(sessionsDir, st)
		return
	}
	var ps persistedState
	if err := json.Unmarshal(data, &ps); err != nil {
		loadPersistedSessions(sessionsDir, st)
		return
	}
	if len(ps.Threads) > 0 {
		st.threads = append([]thread(nil), ps.Threads...)
		st.threadByID = map[string]thread{}
		for _, t := range st.threads {
			st.threadByID[t.ID] = t
		}
	}
	// Legacy migration path: old state.json may contain items/cursors inline.
	if len(ps.ThreadItems) > 0 && len(st.threadItems) == 0 {
		st.threadItems = ps.ThreadItems
	}
	if len(ps.ThreadCursors) > 0 && len(st.threadCursors) == 0 {
		st.threadCursors = ps.ThreadCursors
	}
	if len(ps.ThreadSession) > 0 {
		st.threadSession = ps.ThreadSession
		st.sessionThread = map[string]string{}
		for tid, sid := range ps.ThreadSession {
			st.sessionThread[sid] = tid
		}
	}
	if len(ps.LoadedThreads) > 0 {
		st.loadedThreads = map[string]bool{}
		for _, tid := range ps.LoadedThreads {
			st.loadedThreads[tid] = true
		}
	}
	if len(ps.Settings) > 0 {
		st.settings = ps.Settings
	}
	if len(ps.Workspaces) > 0 {
		st.workspaces = append([]workspaceInfo(nil), ps.Workspaces...)
	}
	if ps.ActiveWorkspace != "" {
		st.activeWorkspace = ps.ActiveWorkspace
	}
	if len(ps.ThreadProjects) > 0 {
		st.threadProjects = ps.ThreadProjects
	}
	if len(ps.RecentPaths) > 0 {
		st.recentPaths = append([]string(nil), ps.RecentPaths...)
	}
	if len(ps.FavoritePaths) > 0 {
		st.favoritePaths = append([]string(nil), ps.FavoritePaths...)
	}
	loadPersistedSessions(sessionsDir, st)
}

func loadPersistedSessions(sessionsDir string, st *serverState) {
	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
			continue
		}
		p := filepath.Join(sessionsDir, e.Name())
		data, err := os.ReadFile(p)
		if err != nil || len(data) == 0 {
			continue
		}
		var ps persistedSession
		if err := json.Unmarshal(data, &ps); err != nil || ps.Thread.ID == "" {
			continue
		}
		threadID := ps.Thread.ID
		st.threadByID[threadID] = ps.Thread
		st.threadItems[threadID] = append([]threadItem(nil), ps.Items...)
		st.threadCursors[threadID] = ps.Cursor
		if ps.SessionID != "" {
			st.threadSession[threadID] = ps.SessionID
			st.sessionThread[ps.SessionID] = threadID
		}
		if !containsThread(st.threads, threadID) {
			st.threads = append(st.threads, ps.Thread)
		}
	}
}

func discoverInitialWorkspaces(repoRoot string) []workspaceInfo {
	items := []workspaceInfo{}
	if st, err := os.Stat(repoRoot); err == nil && st.IsDir() {
		items = append(items, workspaceInfo{ID: repoRoot, Path: repoRoot, Name: filepath.Base(repoRoot), Active: true, Exists: true})
	}
	return items
}

func parseWorktreeList(text, activePath string) []map[string]any {
	lines := strings.Split(text, "\n")
	items := []map[string]any{}
	cur := map[string]any{}
	flush := func() {
		if cur["path"] != nil {
			if cur["detached"] == nil {
				cur["detached"] = false
			}
			if cur["locked"] == nil {
				cur["locked"] = false
			}
			if cur["prunable"] == nil {
				cur["prunable"] = false
			}
			cur["active"] = asString(cur["path"]) == activePath
			items = append(items, cur)
		}
		cur = map[string]any{}
	}
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			flush()
			continue
		}
		if strings.HasPrefix(ln, "worktree ") {
			cur["path"] = strings.TrimPrefix(ln, "worktree ")
		} else if strings.HasPrefix(ln, "HEAD ") {
			cur["head"] = strings.TrimPrefix(ln, "HEAD ")
		} else if strings.HasPrefix(ln, "branch ") {
			cur["branch"] = strings.TrimPrefix(strings.TrimPrefix(ln, "branch "), "refs/heads/")
		} else if ln == "detached" {
			cur["detached"] = true
		} else if strings.HasPrefix(ln, "locked") {
			cur["locked"] = true
		} else if strings.HasPrefix(ln, "prunable") {
			cur["prunable"] = true
		}
	}
	flush()
	return items
}

func runGit(cwd string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %s failed: %s", strings.Join(args, " "), strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

func asMap(v any) map[string]any {
	if v == nil {
		return nil
	}
	if m, ok := v.(map[string]any); ok {
		return m
	}
	b, _ := json.Marshal(v)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	return m
}

func asString(v any) string {
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	default:
		return 0, false
	}
}

func absPath(p string) string {
	if p == "" {
		return ""
	}
	if filepath.IsAbs(p) {
		return filepath.Clean(p)
	}
	wd, _ := os.Getwd()
	return filepath.Clean(filepath.Join(wd, p))
}

func emptyToNil(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func nullToString(v any) string {
	if v == nil {
		return ""
	}
	return asString(v)
}

func containsString(arr []string, x string) bool {
	for _, item := range arr {
		if item == x {
			return true
		}
	}
	return false
}

func removeString(arr []string, x string) []string {
	out := arr[:0]
	for _, item := range arr {
		if item != x {
			out = append(out, item)
		}
	}
	return out
}

func touchRecent(arr []string, x string) []string {
	out := []string{x}
	for _, item := range arr {
		if item != x {
			out = append(out, item)
		}
		if len(out) >= 12 {
			break
		}
	}
	return out
}

func containsThread(arr []thread, id string) bool {
	for _, t := range arr {
		if t.ID == id {
			return true
		}
	}
	return false
}

func shortID(id string) string {
	if len(id) >= 8 {
		return id[:8]
	}
	return id
}

func sanitizeSessionFilename(threadID string) string {
	if threadID == "" {
		return "unknown"
	}
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "..", "_")
	return replacer.Replace(threadID)
}

func copyStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func copyInt64Map(in map[string]int64) map[string]int64 {
	if len(in) == 0 {
		return map[string]int64{}
	}
	out := make(map[string]int64, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func copyThreadItems(in map[string][]threadItem) map[string][]threadItem {
	if len(in) == 0 {
		return map[string][]threadItem{}
	}
	out := make(map[string][]threadItem, len(in))
	for k, v := range in {
		out[k] = append([]threadItem(nil), v...)
	}
	return out
}

func loadedThreadIDs(in map[string]bool) []string {
	ids := make([]string, 0, len(in))
	for id, ok := range in {
		if ok {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

func cloneMapAny(in map[string]any) map[string]any {
	if in == nil {
		return map[string]any{}
	}
	b, err := json.Marshal(in)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		return map[string]any{}
	}
	return out
}

func stringifyOutput(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

func mustNoErr(err error) {
	if err != nil {
		panic(err)
	}
}

var _ = errors.New
var _ = mustNoErr

func resolveDataDir() string {
	if v := strings.TrimSpace(os.Getenv("ALICLOUD_SKILLS_HOME")); v != "" {
		return absPath(v)
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return absPath(".alicloud-skills")
	}
	return filepath.Join(home, ".alicloud-skills")
}
