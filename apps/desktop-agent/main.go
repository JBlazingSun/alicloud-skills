package main

import (
	"context"
	"embed"
	"io/fs"
	"os"

	"github.com/cinience/alicloud-skills/internal/agent"
	"github.com/joho/godotenv"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	_ = godotenv.Load()

	repoRoot := agent.ResolveRepoRoot("")
	eng, err := agent.NewEngine(context.Background(), agent.Config{RepoRoot: repoRoot})
	if err != nil {
		_, _ = os.Stderr.WriteString("init failed: " + err.Error() + "\n")
		os.Exit(1)
	}

	rpcAddr := "127.0.0.1:10112"
	if v := os.Getenv("ALICLOUD_SKILLS_RPC_ADDR"); v != "" {
		rpcAddr = v
	}
	rpcSrv := newRPCServer(rpcAddr, eng, repoRoot)
	if err := rpcSrv.start(); err != nil {
		_, _ = os.Stderr.WriteString("rpc server start failed: " + err.Error() + "\n")
		os.Exit(1)
	}

	app := NewApp(eng)
	distFS, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		_, _ = os.Stderr.WriteString("init assets failed: " + err.Error() + "\n")
		os.Exit(1)
	}

	if err := wails.Run(&options.App{
		Title:  "Alibaba Cloud Agent Desktop",
		Width:  1200,
		Height: 800,
		AssetServer: &assetserver.Options{
			Assets: distFS,
		},
		OnStartup: app.startup,
		OnShutdown: func(ctx context.Context) {
			_ = rpcSrv.stop(ctx)
			app.shutdown(ctx)
		},
		Bind: []interface{}{
			app,
		},
	}); err != nil {
		_, _ = os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
}
