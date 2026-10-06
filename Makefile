DEPLOY_HOST ?= gfe
DEPLOY_DIR ?= /opt/bricks-war

VERSION_BUMP ?= patch

.PHONY: build test deploy prepare-deploy help

build:
	npm run build

test:
	npm test

prepare-deploy:
	node scripts/prepare-deploy.mjs $(VERSION_BUMP)

deploy: prepare-deploy build
	node scripts/desktop/prepare.mjs
	tar -C dist -czf - . | ssh -o BatchMode=yes $(DEPLOY_HOST) 'set -eu; install -d -m 755 $(DEPLOY_DIR); tar -xzf - -C $(DEPLOY_DIR); find $(DEPLOY_DIR) -type f -exec chmod 644 {} +'
	@if ssh -o BatchMode=yes $(DEPLOY_HOST) 'test -L $(DEPLOY_DIR)/desktop'; then DEPLOY_HOST=$(DEPLOY_HOST) node scripts/desktop/publish.mjs; fi

help:
	@printf '%s\n' 'make build                         — production build' 'make test                          — run tests' 'make deploy [VERSION_BUMP=patch]   — bump version, build and upload' 'make deploy VERSION_BUMP=minor     — deploy a backward-compatible feature' 'make deploy VERSION_BUMP=major     — deploy an incompatible change'
