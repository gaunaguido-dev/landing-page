SHELL        := bash
.SHELLFLAGS  := -euo pipefail -c
.DEFAULT_GOAL := help

INFRA_DIR   := $(shell dirname $(realpath $(lastword $(MAKEFILE_LIST))))
TF_DIR      := $(INFRA_DIR)/terraform
SCRIPTS_DIR := $(INFRA_DIR)/scripts
LAMBDA_DIR  := $(INFRA_DIR)/lambdas/send-email

# ── Help ──────────────────────────────────────────────────────────────────────

.PHONY: help
help:
	@echo ""
	@echo "  g2techwork Infrastructure"
	@echo "  ─────────────────────────────────────────────────────────────"
	@echo "  make init           Initialise Terraform (run once)"
	@echo "  make plan           Preview infrastructure changes"
	@echo "  make apply          Provision / update infrastructure"
	@echo "  make build-lambda   Compile the send-email Lambda bundle"
	@echo "  make deploy         Full deploy: infra + site sync"
	@echo "  make deploy-site    Sync site to S3 + invalidate CloudFront"
	@echo "  make invalidate     Invalidate CloudFront cache only"
	@echo "  make outputs        Print all Terraform outputs"
	@echo "  make destroy        ⚠️  Destroy ALL infrastructure"
	@echo ""

# ── Terraform ─────────────────────────────────────────────────────────────────

.PHONY: init
init:
	cd $(TF_DIR) && terraform init

.PHONY: plan
plan:
	cd $(TF_DIR) && terraform plan -var-file=terraform.tfvars

.PHONY: apply
apply: build-lambda
	cd $(TF_DIR) && terraform apply -var-file=terraform.tfvars

.PHONY: outputs
outputs:
	cd $(TF_DIR) && terraform output

# ── Lambda ────────────────────────────────────────────────────────────────────

.PHONY: build-lambda
build-lambda:
	@echo "→ Building Lambda..."
	cd $(LAMBDA_DIR) && npm ci --silent && npm run build
	@echo "✓ Lambda built"

# ── Site deploy ───────────────────────────────────────────────────────────────

.PHONY: deploy
deploy: apply deploy-site

.PHONY: deploy-site
deploy-site:
	$(SCRIPTS_DIR)/deploy-site.sh

.PHONY: invalidate
invalidate:
	$(SCRIPTS_DIR)/invalidate-cache.sh

# ── Destroy ───────────────────────────────────────────────────────────────────

.PHONY: destroy
destroy:
	@echo "⚠️  WARNING: This will permanently destroy ALL g2techwork infrastructure."
	@read -r -p "Type 'destroy' to confirm: " confirm; [ "$$confirm" = "destroy" ] || exit 1
	cd $(TF_DIR) && terraform destroy -var-file=terraform.tfvars
