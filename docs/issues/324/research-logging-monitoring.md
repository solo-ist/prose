# Logging & Monitoring Research Spike

**Issue**: #324
**Date**: 2026-03-13
**Status**: Research complete

---

## Current State

Prose has **no logging infrastructure**. The codebase uses ~345 scattered `console.log`/`console.error`/`console.warn` calls across 41 files. There is no error tracking, no structured logging, no centralized log aggregation, and no analytics/telemetry. Logs are lost when the app closes.

Key patterns observed:
- Prefixed messages (`[Main]`, `[reMarkable]`, `[MCP]`, `[LLM]`, etc.)
- Structured error handling with result objects (`{ success, error, code }`)
- Custom retry logic with exponential backoff (`src/shared/utils/retry.ts`)
- No log persistence, no user-facing diagnostics export

---

## Option 1: electron-log

**What it is**: The de facto logging library for Electron apps. Writes to OS-appropriate log files automatically.

| Attribute | Detail |
|-----------|--------|
| **Pricing** | Free, MIT license |
| **Electron support** | Purpose-built. Works in both main and renderer processes out of the box |
| **Log destinations** | File (OS log dir), console, remote URL, custom transports |
| **Setup complexity** | Very low — drop-in `console.log` replacement |
| **Resource footprint** | Minimal — file I/O only |
| **Community** | ~1.3M weekly npm downloads, actively maintained |

**Log file locations**:
- macOS: `~/Library/Logs/prose/main.log`
- Windows: `%USERPROFILE%\AppData\Roaming\prose\logs\main.log`
- Linux: `~/.config/prose/logs/main.log`

**Pros**:
- Zero-config for Electron — just `import log from 'electron-log'` and replace `console.log`
- Automatic log rotation (default 1MB)
- Supports log levels (error, warn, info, verbose, debug, silly)
- Built-in remote transport for sending logs to a server
- Users can easily find/share log files for support
- Can catch unhandled exceptions and rejections

**Cons**:
- Electron-specific — won't work in the web/browser build
- No built-in log aggregation dashboard
- Basic formatting compared to winston/pino
- No structured JSON logging by default (can be configured)

**Verdict**: **Strong recommendation for local logging layer.** This is the standard choice for Electron apps and would immediately solve the "logs vanish on close" problem.

---

## Option 2: winston

**What it is**: The most popular general-purpose Node.js logging library. Supports multiple transports (file, console, HTTP, syslog, etc.).

| Attribute | Detail |
|-----------|--------|
| **Pricing** | Free, MIT license |
| **Electron support** | Works in main process. Needs adaptation for renderer (IPC bridge) |
| **Setup complexity** | Moderate — requires transport configuration |
| **Resource footprint** | Low-moderate. Heavier than electron-log or pino |
| **Community** | ~15M weekly npm downloads, mature ecosystem |

**Pros**:
- Extremely flexible transport system (file, HTTP, MongoDB, Elasticsearch, etc.)
- Structured JSON logging out of the box
- Log levels, metadata, custom formats
- Large ecosystem of community transports (`winston-elasticsearch`, `winston-loki`, etc.)
- Battle-tested in production Node.js apps

**Cons**:
- Not Electron-aware — requires manual setup for renderer process logging via IPC
- More configuration overhead than electron-log
- Slower than pino (synchronous string interpolation)
- Overkill for a desktop app that just needs file + console logging

**Verdict**: Good general-purpose option, but electron-log is better suited for this use case. Winston shines in server-side Node.js apps.

---

## Option 3: pino

**What it is**: Ultra-fast JSON logger for Node.js. Focuses on performance by deferring serialization.

| Attribute | Detail |
|-----------|--------|
| **Pricing** | Free, MIT license |
| **Electron support** | Works in main process. Renderer requires IPC bridge |
| **Setup complexity** | Low-moderate |
| **Resource footprint** | Very low — fastest Node.js logger (~5x faster than winston) |
| **Community** | ~7M weekly npm downloads, actively maintained |

**Pros**:
- Extremely fast (ndjson output, minimal overhead)
- Structured JSON by default — great for log aggregation pipelines
- `pino-pretty` for human-readable dev output
- Lightweight, low memory footprint
- Transport ecosystem (pino-elasticsearch, pino-loki, etc.)

**Cons**:
- JSON-only output — less readable without `pino-pretty`
- Not Electron-aware — same IPC challenges as winston
- Speed advantage is largely irrelevant for a desktop app (not handling thousands of requests/sec)
- Extra dependency for pretty-printing in development

**Verdict**: Excellent logger, but its speed advantages don't matter for a desktop app. The JSON-first design is great if we plan to pipe logs to an aggregation backend.

---

## Option 4: bunyan

**What it is**: Another JSON-focused Node.js logger with a CLI tool for viewing logs.

| Attribute | Detail |
|-----------|--------|
| **Pricing** | Free, MIT license |
| **Electron support** | Main process only |
| **Setup complexity** | Low |
| **Resource footprint** | Low |
| **Community** | ~1M weekly downloads, **mostly in maintenance mode** |

**Pros**:
- Clean JSON output with nice CLI viewer (`bunyan` command)
- Child loggers for adding context
- Stream-based architecture

**Cons**:
- Maintenance mode — less active development than pino or winston
- Not Electron-aware
- Smaller ecosystem than winston or pino
- Functionally superseded by pino

**Verdict**: **Not recommended.** Effectively superseded by pino. No compelling reason to choose it over the alternatives.

---

## Option 5: Sentry (Error Tracking)

**What it is**: The industry-standard error tracking and performance monitoring SaaS. Has a dedicated Electron SDK.

| Attribute | Detail |
|-----------|--------|
| **Pricing** | Free tier: 5K errors/month, 10K performance units. Paid starts ~$26/month |
| **Electron support** | **First-class.** `@sentry/electron` wraps both main and renderer processes |
| **Setup complexity** | Low — initialize once, errors captured automatically |
| **Resource footprint** | Low — lightweight SDK, batched uploads |
| **Community** | Industry standard, 12K+ GitHub stars on JS SDK |

**How it works with Electron**:
- `@sentry/electron` automatically captures crashes in both main and renderer
- Captures unhandled exceptions, unhandled promise rejections
- Native crash reporting (minidump upload) for Electron main process crashes
- Source maps support for renderer errors
- Breadcrumbs (trail of events leading to an error)
- Release tracking and deploy integration

**Pros**:
- Purpose-built Electron SDK — easiest integration path
- Automatic error grouping, deduplication, and alerting
- Stack traces with source maps
- Performance monitoring (transaction tracing)
- User context (attach user info to errors without PII)
- Issue assignment, Slack/email alerts
- Generous free tier for a desktop app

**Cons**:
- Error tracking only — not a full logging solution (no log search/aggregation)
- Requires internet connectivity to report errors
- Privacy consideration: error data (stack traces, breadcrumbs) is sent to Sentry servers
- Self-hosted option exists but is complex to operate

**Verdict**: **Strong recommendation for error tracking.** This is the standard choice and the Electron SDK makes it trivial. Complements electron-log (local logs) perfectly.

---

## Option 6: BugSnag

**What it is**: Error monitoring platform, now part of SmartBear (rebranded "Insight Hub").

| Attribute | Detail |
|-----------|--------|
| **Pricing** | Free tier: 7,500 events/month. Standard starts ~$99/month |
| **Electron support** | No dedicated Electron SDK. Use `@bugsnag/js` for renderer, `@bugsnag/node` for main |
| **Setup complexity** | Moderate — need to configure two separate SDKs |
| **Resource footprint** | Low |
| **Community** | Smaller than Sentry |

**Pros**:
- Stability scores per release
- Good error grouping
- Free tier is reasonable

**Cons**:
- No unified Electron SDK — must configure main and renderer separately
- More expensive than Sentry at equivalent tiers
- Less community adoption for Electron specifically
- Recently absorbed into SmartBear — product direction uncertain

**Verdict**: **Not recommended over Sentry.** Sentry has a better Electron story, larger community, and more generous free tier.

---

## Option 7: Datadog RUM + Logs

**What it is**: Full-stack observability platform (infrastructure monitoring, APM, logs, RUM).

| Attribute | Detail |
|-----------|--------|
| **Pricing** | Log ingestion ~$0.10/GB. RUM $1.50/1K sessions. Adds up fast |
| **Electron support** | No Electron SDK. Browser RUM SDK could work in renderer with caveats |
| **Setup complexity** | High — designed for server infrastructure, not desktop apps |
| **Resource footprint** | Moderate (agents, SDK overhead) |
| **Community** | Dominant in enterprise DevOps |

**Pros**:
- Best-in-class dashboards and alerting
- Correlate logs, metrics, traces in one platform
- Powerful log search and analytics

**Cons**:
- **Extremely expensive** — mid-size deployments easily $50K-$150K/year
- Designed for server infrastructure, not desktop apps
- No Electron SDK — would require significant custom integration
- Overkill for a desktop writing app
- Privacy concerns: all user activity sent to Datadog servers

**Verdict**: **Not recommended.** Designed for server infrastructure at scale. Wrong tool for a desktop app. Cost alone is disqualifying.

---

## Option 8: ELK Stack (Elasticsearch + Logstash + Kibana)

**What it is**: The classic open-source log aggregation stack. Elasticsearch indexes and stores logs, Logstash ingests/transforms them, Kibana provides dashboards and search.

| Attribute | Detail |
|-----------|--------|
| **Pricing** | Free (self-hosted, Apache 2.0 / SSPL). Elastic Cloud starts ~$95/month |
| **Electron support** | None — purely a backend log aggregation stack |
| **Setup complexity** | **Very high.** Requires running 3 services, managing cluster health, storage, indices |
| **Resource footprint on server** | **Heavy.** Elasticsearch alone needs 4+ GB RAM minimum. Production: 16-64+ GB |
| **Resource footprint on client** | Minimal — just HTTP log shipping |
| **Community** | Massive. ELK is the most widely deployed log aggregation stack |

**How it would work for Prose**:
1. App writes structured logs locally (via electron-log or pino)
2. A lightweight shipper (e.g., Filebeat or custom HTTP transport) sends logs to Logstash/Elasticsearch
3. Kibana provides dashboards, search, and alerting

**Pros**:
- Incredibly powerful full-text search across logs
- Kibana dashboards are excellent for visualization
- Mature, battle-tested at massive scale
- Can handle any log volume
- Self-hosted = full data control (no privacy concerns)
- Rich query language (KQL)
- Alerting, anomaly detection, machine learning features

**Cons**:
- **Massive operational overhead.** You're running a distributed database cluster
- Elasticsearch is resource-hungry (RAM, disk, CPU)
- Requires dedicated DevOps expertise to maintain
- Index management, shard allocation, cluster upgrades are non-trivial
- Logstash is Java-based and resource-heavy (can be replaced with Filebeat for simpler use cases)
- License changed from Apache 2.0 to SSPL (not truly open source anymore)
- Elastic Cloud managed service eliminates ops overhead but costs $95-$1000+/month
- **Wildly overkill for a desktop app with a small user base**

**When ELK makes sense**:
- Large-scale server applications generating GB/TB of logs daily
- Teams with dedicated DevOps/SRE staff
- Need for complex log analytics, anomaly detection, ML
- Already running Elasticsearch for other purposes (search, etc.)

**Verdict**: **Not recommended for Prose.** The operational complexity and resource requirements are disproportionate to the needs of a desktop writing app. ELK is designed for organizations processing millions of log events per day across hundreds of servers. For Prose, this is like using a fire hose to water a houseplant.

---

## Option 9: Grafana + Loki

**What it is**: Lightweight log aggregation system inspired by Prometheus. Loki indexes only labels/metadata (not full text), making it much cheaper to run than Elasticsearch.

| Attribute | Detail |
|-----------|--------|
| **Pricing** | Free (self-hosted, AGPL). Grafana Cloud free tier: 50GB logs/month |
| **Electron support** | None — backend stack. Client ships logs via HTTP (Promtail or custom) |
| **Setup complexity** | Moderate. Much simpler than ELK, but still requires server infrastructure |
| **Resource footprint on server** | Low-moderate. Loki is designed to be cost-effective (no full-text indexing) |
| **Resource footprint on client** | Minimal — HTTP log shipping |
| **Community** | Fast-growing. 25K+ GitHub stars |

**How it compares to ELK**:
| | ELK | Grafana + Loki |
|---|-----|----------------|
| Full-text search | Yes (core strength) | No (grep-like, label-based) |
| Server RAM | 4-64+ GB | 512MB-4GB |
| Storage cost | High (indexes everything) | Low (stores raw logs, indexes labels only) |
| Operational complexity | High | Moderate |
| Query language | KQL | LogQL (Prometheus-inspired) |
| Dashboard | Kibana | Grafana |
| Ecosystem | Larger, more mature | Growing fast, part of Grafana ecosystem |

**Pros**:
- 10-100x cheaper to run than Elasticsearch for equivalent log volumes
- Grafana dashboards are excellent
- Grafana Cloud free tier is generous (50GB logs/month)
- Simpler operations than ELK
- Label-based querying works well for structured logs
- Native integration with Grafana alerting

**Cons**:
- No full-text search — must know what you're looking for (label-based queries)
- Less mature than ELK
- Still requires server infrastructure (even if lighter)
- AGPL license may be a concern for some
- Querying large log volumes without the right labels is slow

**Verdict**: **Better than ELK for Prose, but still likely overkill.** If you need centralized log aggregation in the future, Grafana Cloud's free tier is a good starting point without self-hosting complexity.

---

## Option 10: OpenTelemetry

**What it is**: Vendor-neutral observability framework for generating, collecting, and exporting telemetry data (traces, metrics, logs). It's a CNCF project and the emerging industry standard.

| Attribute | Detail |
|-----------|--------|
| **Pricing** | Free, Apache 2.0. Backend costs depend on chosen backend |
| **Electron support** | `@opentelemetry/sdk-node` for main process, browser SDK for renderer |
| **Setup complexity** | Moderate-high. OTel is a framework, not a complete solution — needs a backend |
| **Resource footprint** | Low-moderate (collector adds overhead) |
| **Community** | Second-largest CNCF project after Kubernetes |

**Pros**:
- Vendor-neutral — switch backends without changing instrumentation code
- Unified API for traces, metrics, and logs
- Future-proof (becoming the standard)
- Can export to any backend: Jaeger, Zipkin, Prometheus, Grafana, Datadog, etc.
- Auto-instrumentation for HTTP, database calls, etc.

**Cons**:
- Complexity. OTel is a framework, not a turnkey solution
- Logging API is the least mature part of OTel (traces and metrics are more stable)
- Requires a separate backend for storage/visualization
- Overkill for "I just want logs in a file"
- Learning curve is steep

**Verdict**: **Not recommended as a starting point.** OTel is the right choice if you're building a microservices architecture and want vendor-neutral observability. For a desktop app, it adds complexity without proportionate value. However, if Prose grows to have server-side components, adopting OTel later would be wise.

---

## ELK vs. Alternatives: Head-to-Head

| Criteria | ELK Stack | Grafana + Loki | Sentry | electron-log |
|----------|-----------|----------------|--------|--------------|
| **Purpose** | Log aggregation + search | Log aggregation + dashboards | Error tracking | Local file logging |
| **Cost** | $0 self-hosted / $95+/mo cloud | $0 self-hosted / free tier cloud | Free tier 5K errors/mo | Free |
| **Ops overhead** | Very high | Moderate | None (SaaS) | None |
| **Electron SDK** | No | No | Yes (first-class) | Yes (purpose-built) |
| **Setup time** | Days-weeks | Hours-days | Minutes | Minutes |
| **Min server RAM** | 4 GB | 512 MB | N/A | N/A |
| **Full-text search** | Excellent | Limited | Error-focused | Local file grep |
| **Right for desktop app?** | No | Maybe (if scaling) | Yes | Yes |

---

## Privacy Considerations

This is a **writing app**. Log data could inadvertently contain:
- Document content (if logged during save/sync operations)
- File paths (revealing directory structure, project names)
- API keys (if logged during LLM calls)
- reMarkable/Google account identifiers

**Recommendations**:
1. **Never log document content** — sanitize before logging
2. **Redact API keys** in log output (mask all but last 4 chars)
3. **Opt-in telemetry only** — if sending logs externally, require explicit user consent
4. **Local-first logging** — default to file-only, with optional remote reporting
5. **Data minimization** — log events and errors, not payloads

---

## Recommendation

### Tier 1: Do now (immediate value, low effort)

**electron-log** for structured local logging
- Replace all `console.log` → `log.info`, `console.error` → `log.error`, etc.
- Gives users exportable log files for support
- ~1 day of work to integrate across the codebase
- Works with the existing prefix convention (`[Main]`, `[LLM]`, etc.)

### Tier 2: Do soon (high value, moderate effort)

**Sentry** (`@sentry/electron`) for error tracking
- Captures crashes and unhandled errors automatically
- Stack traces with source maps
- Free tier is more than sufficient for current scale
- ~2-4 hours to integrate
- Add opt-in consent dialog for privacy

### Tier 3: Consider later (if/when needed)

**Grafana Cloud + Loki** for centralized log aggregation
- Only needed when user base grows enough that local logs aren't sufficient
- Free tier (50GB/month) covers a lot
- Ship critical errors/events via electron-log's remote transport
- Consider if you need to see patterns across many users' error reports

### Not recommended for Prose

| Option | Why not |
|--------|---------|
| **ELK Stack** | Massive operational overhead, resource-hungry, designed for server-scale log volumes |
| **Datadog** | Extremely expensive, no Electron SDK, designed for server infrastructure |
| **BugSnag** | No Electron SDK, more expensive than Sentry, less community adoption |
| **OpenTelemetry** | Over-engineered for a desktop app, steep learning curve |
| **bunyan** | Maintenance mode, superseded by pino |
| **winston** | Good but electron-log is purpose-built for this exact use case |
| **pino** | Speed advantages irrelevant for desktop app; electron-log is better fit |

### Proposed Architecture

```
┌─────────────────────────────────────────┐
│              Prose App                  │
│                                         │
│  ┌─────────┐    ┌──────────────────┐   │
│  │ Renderer │───▶│  electron-log    │   │
│  │ Process  │    │  (all processes) │   │
│  └─────────┘    └──────┬───────────┘   │
│  ┌─────────┐           │               │
│  │  Main   │───────────┤               │
│  │ Process │           │               │
│  └─────────┘    ┌──────▼───────────┐   │
│                 │  Local log files  │   │
│                 │  ~/Library/Logs/  │   │
│                 │  prose/main.log   │   │
│                 └──────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  @sentry/electron (opt-in)     │   │
│  │  Crashes + unhandled errors     │   │
│  │  → Sentry cloud                 │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### Implementation Notes

1. **electron-log** can be aliased to the global `console` object, making migration trivial:
   ```ts
   import log from 'electron-log';
   // In main process:
   Object.assign(console, log.functions);
   ```

2. **For the web build**, electron-log won't work. Use a thin wrapper:
   ```ts
   // src/renderer/lib/logger.ts
   export const logger = window.api
     ? electronLog  // Electron: use electron-log
     : console;     // Web: fall back to console
   ```

3. **Sentry init** would go in both `src/main/index.ts` and the renderer entry point, guarded by a user consent check from settings.
