package main

type rpcRequest struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      interface{}    `json:"id,omitempty"`
	Method  string         `json:"method"`
	Params  map[string]any `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id,omitempty"`
	Result  interface{} `json:"result,omitempty"`
	Error   *rpcError   `json:"error,omitempty"`
}

type rpcNotification struct {
	JSONRPC string      `json:"jsonrpc"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
}

type rpcError struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

type thread struct {
	ID        string `json:"id"`
	Title     string `json:"title,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
}

type threadItem struct {
	ID        string `json:"id"`
	ThreadID  string `json:"threadId"`
	Role      string `json:"role,omitempty"`
	Content   string `json:"content,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
	Cursor    int64  `json:"cursor"`
	TurnID    string `json:"turnId,omitempty"`
	Raw       any    `json:"raw,omitempty"`
}

type taskSpec struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Prompt          string `json:"prompt"`
	WorkspacePath   string `json:"workspacePath,omitempty"`
	ThreadID        string `json:"threadId,omitempty"`
	ScheduleMinutes int    `json:"scheduleMinutes"`
	Enabled         bool   `json:"enabled"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
	NextRunAt       string `json:"nextRunAt,omitempty"`
	LastRunAt       string `json:"lastRunAt,omitempty"`
	LastRunStatus   string `json:"lastRunStatus,omitempty"`
	LastError       string `json:"lastError,omitempty"`
}
