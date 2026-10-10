PYTHON ?= .venv/bin/python
USE_FIXTURES ?= 1
.PHONY: help hooks unlock-push doctor fixtures-check data features train evaluate explain artifacts api web test clean
help:
	@printf '%s\n' 'Argus: help hooks unlock-push doctor fixtures-check data features train evaluate explain artifacts api web test clean' 'Pushing locked; unlock-push is human-only guidance.'
hooks:
	$(PYTHON) scripts/install_hooks.py
unlock-push:
	@printf '%s\n' 'HUMAN ONLY: after confirming the official event start, manually create .push_unlocked in the repo root. Agents must never do this. No push runs automatically.'
doctor:
	$(PYTHON) scripts/doctor.py
fixtures-check:
	$(PYTHON) -m tests.schemas.validate fixtures
data:
	$(PYTHON) -m ml.data
features: data
	$(PYTHON) -m ml.features
train: features
	$(PYTHON) -m ml.train
evaluate: train
	$(PYTHON) -m ml.evaluate
explain: evaluate
	$(PYTHON) -m ml.explain
artifacts: explain
	$(PYTHON) -m tests.schemas.validate artifacts
api:
	USE_FIXTURES=$(USE_FIXTURES) $(PYTHON) -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
web:
	cd frontend && npm run dev -- --host 127.0.0.1
test:
	$(PYTHON) -m pytest tests -q
	cd frontend && npm run build
clean:
	@printf '%s\n' 'No destructive cleanup is automatic. Remove only known generated outputs manually.'
