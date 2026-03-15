# Prose Documentation

Navigation index for all project documentation.

---

## Developer Guide

| Document | Purpose |
|----------|---------|
| [`../CLAUDE.md`](../CLAUDE.md) | Primary agent instructions: commands, workflow, architecture, security rules, patterns index |
| [`patterns.md`](patterns.md) | Implementation recipes: settings tabs, IPC channels, TipTap extensions, panels, stores, AI tools |
| [`troubleshooting.md`](troubleshooting.md) | Recovery playbook: dev server failures, build errors, IPC issues, streaming problems |

## Architecture

| Document | Purpose |
|----------|---------|
| [`architecture/llm-pipeline.md`](architecture/llm-pipeline.md) | LLM request/stream lifecycle, tool modes, suggestion pipeline, provider notes |

## Issues

Per-issue design docs and implementation notes live in `issues/<number>/`. See [`issues/README.md`](issues/README.md) for conventions.

Notable docs:
- `issues/127/` — Chat panel improvements
- `issues/14/` — ...
- (see `issues/` directory for full list)

## Research & Spikes

Exploratory research and proof-of-concept notes:

- `spikes/` — Time-boxed technical investigations
- `research/` — Background research on external systems

## Roadmap

The project roadmap is tracked on the [GitHub project board](https://github.com/solo-ist/prose/projects). See open issues for current work: https://github.com/solo-ist/prose/issues

> `roadmap.md` is retired — it contained a stale MVP snapshot from December 2024 and is superseded by the live project board.

## QA

Automated QA is done via Circuit Electron MCP. See the QA workflow in `CLAUDE.md` → QA Testing.

> `QA_feedback.md` is retired — active QA feedback is tracked in GitHub issues.
