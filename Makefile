GO ?= go
PNPM ?= pnpm
BINDIR ?= build/bin
CLI_NAME ?= alicloud-skills
DESKTOP_NAME ?= alicloud-skills-desktop
DESKTOP_TAGS ?= production,webkit2_41
APPS_DIR ?= apps
RUN_ARGS ?=

.PHONY: all fmt test build build-cli build-desktop run web-install build-web build-web-desktop sync-desktop-web clean

all: build

fmt:
	$(GO) -C $(APPS_DIR) fmt ./...

test:
	$(GO) -C $(APPS_DIR) test ./...

# Default build is optimized for CLI + Desktop packaging.
# `build-web` can still be run explicitly when plain web output is needed.
build: build-cli build-desktop

build-cli:
	@mkdir -p $(BINDIR)
	$(GO) -C $(APPS_DIR) build -o ../$(BINDIR)/$(CLI_NAME) ./cmd/alicloud-skills

build-desktop: sync-desktop-web
	@mkdir -p $(BINDIR)
	$(GO) -C $(APPS_DIR) build -tags "$(DESKTOP_TAGS)" -o ../$(BINDIR)/$(DESKTOP_NAME) ./desktop

run:
	$(GO) -C $(APPS_DIR) run ./cmd/alicloud-skills $(RUN_ARGS)

web-install:
	$(PNPM) --dir apps/web install --frozen-lockfile --ignore-scripts

build-web: web-install
	$(PNPM) --dir apps/web build

build-web-desktop: web-install
	NEXT_DESKTOP_EMBED=1 NEXT_PUBLIC_WS_URL=ws://127.0.0.1:10112/ws $(PNPM) --dir apps/web build

sync-desktop-web: build-web-desktop
	@test -d apps/web/out || (echo "apps/web/out not found, run make build-web first" && exit 1)
	@mkdir -p apps/desktop/frontend/dist
	rsync -a --delete apps/web/out/ apps/desktop/frontend/dist/

clean:
	rm -rf $(BINDIR)
	rm -rf apps/build/bin
