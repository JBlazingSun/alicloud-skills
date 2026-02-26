GO ?= go
PNPM ?= pnpm
BINDIR ?= build/bin
CLI_NAME ?= alicloud-skills
DESKTOP_NAME ?= alicloud-skills-desktop
DESKTOP_TAGS ?= production,webkit2_41

.PHONY: all fmt test build build-cli build-desktop build-web build-web-desktop sync-desktop-web clean

all: build

fmt:
	$(GO) fmt ./...

test:
	$(GO) test ./...

build: build-cli build-web sync-desktop-web build-desktop

build-cli:
	@mkdir -p $(BINDIR)
	$(GO) build -o $(BINDIR)/$(CLI_NAME) ./cmd/alicloud-skills

build-desktop: sync-desktop-web
	@mkdir -p $(BINDIR)
	$(GO) build -tags "$(DESKTOP_TAGS)" -o $(BINDIR)/$(DESKTOP_NAME) ./apps/desktop-agent

build-web:
	$(PNPM) --dir apps/web install --frozen-lockfile
	$(PNPM) --dir apps/web build

build-web-desktop:
	$(PNPM) --dir apps/web install --frozen-lockfile
	NEXT_DESKTOP_EMBED=1 NEXT_PUBLIC_WS_URL=ws://127.0.0.1:10112/ws $(PNPM) --dir apps/web build

sync-desktop-web: build-web-desktop
	@test -d apps/web/out || (echo "apps/web/out not found, run make build-web first" && exit 1)
	@mkdir -p apps/desktop-agent/frontend/dist
	rsync -a --delete apps/web/out/ apps/desktop-agent/frontend/dist/

clean:
	rm -rf $(BINDIR)
