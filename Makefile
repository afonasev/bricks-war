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

deploy: build
	node scripts/desktop/prepare.mjs
	node scripts/desktop/publish-content-github.mjs --publish
	tar -C dist -czf - . | ssh -o BatchMode=yes $(DEPLOY_HOST) 'set -eu; install -d -m 755 $(DEPLOY_DIR); tar -xzf - -C $(DEPLOY_DIR); find $(DEPLOY_DIR) -type f -exec chmod 644 {} +'

help:
	@printf '%s\n' 'make build                         — production build' 'make test                          — run tests' 'make prepare-deploy VERSION_BUMP=patch — prepare version, then verify/commit/export source' 'make deploy                        — build/sign/publish the committed version to GitHub, then upload web'
