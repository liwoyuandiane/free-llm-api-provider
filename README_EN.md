<!--
╔══════════════════════════════════════════════════════════════╗
║  free-llm-api-provider                                     ║
║  Local LLM proxy with auto-failover across 25+ free providers ║
╚══════════════════════════════════════════════════════════════╝
-->

<p align="center">
  <a href="https://www.npmjs.com/package/free-llm-api-provider">
    <img src="https://img.shields.io/npm/v/free-llm-api-provider.svg" alt="npm version">
  </a>
  <a href="https://www.npmjs.com/package/free-llm-api-provider">
    <img src="https://img.shields.io/npm/dw/free-llm-api-provider.svg" alt="npm downloads">
  </a>
  <a href="https://github.com/liwoyuandiane/free-llm-api-provider/blob/main/LICENSE">
    <img src="https://img.shields.io/npm/l/free-llm-api-provider.svg" alt="MIT License">
  </a>
  <a href="https://github.com/liwoyuandiane/free-llm-api-provider/pkgs/container/free-llm-api-provider">
    <img src="https://img.shields.io/badge/Docker-ghcr.io-blue?logo=docker" alt="Docker">
  </a>
</p>

<!-- Language selector -->
<p align="center">
  <sub>
    🌐
    <a href="README.md">中文</a> ·
    <strong>English</strong>
  </sub>
</p>

<h1 align="center">free-llm-api-provider</h1>

<p align="center">
  <b>A self-contained local LLM proxy with automatic failover across 25+ free AI providers and 238+ models.</b>
  <br>
  Install once, configure keys, forget about it.
</p>

<hr>

<p align="center">
  <b>Free AI APIs break</b> — rate limits, downtime, capacity issues. Your coding assistant dies mid-session.
  <br>
  <b>free-llm-api-provider</b> runs a local OpenAI-compatible proxy that automatically routes to the next available provider when one fails.
</p>

<hr>

## Features

- **Health-aware routing**: Real-time ping monitoring routes to the healthiest provider instantly
- **Auto-failover**: 429/500/timeout → switch provider automatically
- **Sticky provider**: Once a provider works, keeps using it until it fails (faster response)
- **Multi-key support**: Multiple keys per provider, tries all before failing over
- **238+ models** across 25+ providers (NVIDIA, Groq, OpenRouter, Cerebras, etc.)
- **Tier-based routing**: `tier-splus` (elite) → `tier-b` (default), health scores override tiers
- **Web Admin UI**: Browser-based management at `http://localhost:4002/admin`
- **Real-time status dashboard**: `flap status` shows live provider health, latency, quota
- **10s reliability analysis**: `flap fiable` finds the most stable provider right now
- **Model auto-discovery**: Discover new models from provider endpoints
- **Auto-generated API key**: Cryptographically random key on first run
- **OpenAI-compatible**: Works with Cursor, VS Code, Claude Desktop, OpenCode, any client
- **Zero dependencies**: Pure Node.js. No Python, no Docker required (optional Docker support)
- **Docker support**: One-command deploy, database stored in current directory

## Supported Providers

| # | Provider | Models | Free Tier | Env Var |
|---|----------|--------|-----------|---------|
| 1 | NVIDIA NIM | 13 | ~40 RPM | `NVIDIA_API_KEY` |
| 2 | Groq | 8 | 30 RPM, 1K-14.4K/day | `GROQ_API_KEY` |
| 3 | Cerebras | 4 | 30 RPM, 1M tokens/day | `CEREBRAS_API_KEY` |
| 4 | OpenRouter | 25 | 50/day free, 1K/day ($10) | `OPENROUTER_API_KEY` |
| 5 | SambaNova | 13 | Dev tier generous | `SAMBANOVA_API_KEY` |
| 6 | Hyperbolic | 13 | $1 free credits | `HYPERBOLIC_API_KEY` |
| 7 | Cloudflare | 15 | 10K neurons/day | `CLOUDFLARE_API_TOKEN` |
| 8 | Google AI Studio | 6 | 14.4K/day | `GOOGLE_API_KEY` |
| 9 | ZAI | 7 | Generous quota | `ZAI_API_KEY` |
| 10 | Scaleway | 10 | 1M free tokens | `SCALEWAY_API_KEY` |
| 11 | SiliconFlow | 6 | 100/day + $1 credits | `SILICONFLOW_API_KEY` |
| 12 | **GitHub Models** 🆕 | 7 | Rate limits | `GITHUB_TOKEN` |
| 13 | **Cohere** 🆕 | 4 | Free tier | `COHERE_API_KEY` |
| 14 | **Reka** 🆕 | 3 | Free tier | `REKA_API_KEY` |
| 15 | **Pollinations** 🆕 | 3 | No key needed | — |
| 16 | **LLM7** 🆕 | 4 | No key needed | — |
| 17 | + 10 more | | | |

> Run `flap sync` to sync 790+ models from litellm catalog across 18 providers.

## Quick Start

### 1. Install

```bash
npm install -g free-llm-api-provider
```

> You can also use `npx free-llm-api-provider` without installing, but global install enables the `flap` shorthand.

### 2. Configure API Keys (One-time)

```bash
flap config
```

Interactive wizard prompts for keys. Need only **one** to start. More = better failover.

**Recommended first key**: Groq — https://console.groq.com/keys (30 RPM, no credit card)

**You can also set keys via environment variables:**
```bash
export GROQ_API_KEY="your_key_here"
export NVIDIA_API_KEY="your_key_here"
export OPENROUTER_API_KEY="your_key_here"
```

**Multi-key support**: Add multiple keys for the same provider:
```bash
# Add multiple keys in the config wizard
# The proxy tries all keys before failing over to the next provider
```

**Where are keys stored?**
- SQLite database: `.data/data.db` (all data stored here)
- Default port: `4002` (customize via `FLAP_PORT` or `PORT` env var)
- Or via environment variables (env vars override database)

**Server API Key**: On first run, generates a cryptographically random API key (`sk-<64 hex chars>`) stored in SQLite database. Used by AI clients to connect to the proxy. Override with `FLAP_API_KEY` env var.

### 3. Start Proxy

```bash
flap
```

Proxy runs at `http://localhost:4002`.

### Docker Deployment

```bash
# Pull from GitHub Container Registry
docker pull ghcr.io/liwoyuandiane/free-llm-api-provider:main

# Run from any directory (database saved in current dir)
cd /your/working/dir
docker run -d \
  --name flap \
  -p 4002:4002 \
  -e DATA_DIR=/app/data \
  -e FLAP_API_KEY=your-key \
  -e FLAP_ADMIN_PASSWORD=admin-password \
  -e GROQ_API_KEY=your-key \
  -v $(pwd):/app/data \
  ghcr.io/liwoyuandiane/free-llm-api-provider:main
```

### 4. Configure Your AI Client

| Client | Base URL | API Key |
|--------|----------|---------|
| Cursor | `http://localhost:4002/v1` | Auto-generated key |
| VS Code | `http://localhost:4002/v1` | Same |
| Claude Desktop | `http://localhost:4002/v1` | Same |
| OpenCode | `http://localhost:4002/v1` | Same |

The API key is displayed when the proxy starts:
```
✅ Proxy started on http://localhost:4002
   🔑 API Key:   sk-your-server-api-key (auto-generated on first run)
```

Regenerate from admin UI (Settings tab) or via API:
```bash
curl -X POST http://localhost:4002/api/admin/key/regenerate
```

## CLI Commands

All commands work **with or without `--`**:

```bash
# Start proxy (default)
flap
flap start

# Interactive config wizard
flap config

# Show current config
flap show

# Real-time provider health dashboard (live terminal UI)
flap status

# 10-second reliability analysis
flap fiable

# List all models
flap models

# List S+ tier only
flap models --tier S+

# List models for a provider
flap models --provider groq

# Sync litellm model catalog
flap sync

# Export current models as JSON
flap export-catalog --output ./catalog.json

# Stop / restart proxy
flap stop
flap restart

# View proxy logs
flap logs

# Test proxy health
flap test
```

## Web Admin UI

When the proxy is running, open **http://localhost:4002/admin** in your browser.

Default credentials: `admin` / `admin123`. You'll be prompted to change the password on first login. Set a custom password via `FLAP_ADMIN_PASSWORD` env var.

- **Providers tab**: Enable/disable providers, add/remove keys, test connections, discover models
- **Models tab**: View 238 static models + discovered models, assign tiers, enable/disable
- **Playground tab**: Test chat completions inline (Enter to send, Ctrl+Enter for newline), shows provider and model name in response
- **Health tab**: Real-time provider health scores, latency, quota
- **Stats tab**: Request statistics, rate limit status
- **Custom tab**: Add custom OpenAI-compatible providers
- **Settings tab**: Regenerate API key, change admin password

The admin UI is served by the proxy — no separate server needed.

## API Usage

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4002/v1",
    api_key="your-server-api-key"
)

response = client.chat.completions.create(
    model="tier-splus",
    messages=[{"role": "user", "content": "Write hello world in Rust"}]
)
print(response.choices[0].message.content)
```

### cURL

```bash
curl http://localhost:4002/v1/chat/completions \
  -H "Authorization: Bearer your-server-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tier-splus",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## How Failover Works

### Health-Aware Routing

The proxy continuously pings all providers. Requests are routed to the **healthiest provider first**:

```
Provider Health Scores (updated every 30s):
  Groq      → Score: 95, Latency: 198ms ✅
  Cerebras  → Score: 80, Latency: 299ms
  OpenRouter→ Score: 45, Latency: 1200ms (slow)

Request → Groq (healthiest) → SUCCESS ✓
```

If the healthiest fails, it tries the next by score. Falls back to tier ordering if no health data.

### Traditional Failover (Fallback)

```
Request → NVIDIA → 429 rate limit
        → Groq   → 500 error
        → Cerebras → SUCCESS ✓
```

**Sticky provider optimization:**
```
Request 1: Try providers until one works → OpenRouter ✅
Request 2+: Use OpenRouter directly (fast!)
Request N: OpenRouter fails → Try next → NVIDIA ✅
```

**Multi-key failover:**
```
Groq key 1 → 401 ❌
Groq key 2 → 429 ❌
Groq key 3 → 200 ✅  ← Stays here until it fails
```

## Model Tiers

Based on SWE-bench scores (coding benchmark):

| Tier | Score | Description |
|------|-------|-------------|
| `S+` | 70%+ | Frontier models. Best for complex refactors, architecture decisions |
| `S`  | 60-70% | Excellent coding models. Reliable for most tasks |
| `A+` | 50-60% | Very capable. Great alternatives to frontier models |
| `A`  | 40-50% | Solid performers. Good for general coding |
| `A-` | 35-40% | Decent. Usable for simpler tasks |
| `B+` | 30-35% | Capable for smaller tasks and quick scripts |
| `B`  | 20-30% | Entry-level. Default fallback tier |
| `C`  | <20%   | Basic models. Last resort only |

Use tier aliases: `tier-splus`, `tier-s`, `tier-aplus`, `tier-a`, `tier-aminus`, `tier-bplus`, `tier-b`

## Data Storage

All configuration is stored in the SQLite database `.data/data.db`. API keys are encrypted with AES-256-GCM.

**Priority:**
1. Environment variables (highest)
2. SQLite database
3. Multiple keys (tries all before failing over)

## Data Directory

All runtime data is stored in the `.data/` directory under the project root. **Just back up `data.db` to fully migrate**:

```
your-project/
├── .data/
│   └── data.db       ← SQLite database (API keys, provider config, sessions, rate limits — everything)
├── src/
├── ...
```

**Override with the `DATA_DIR` environment variable:**

```bash
# Linux / macOS
export DATA_DIR=/path/to/my-data
flap

# Windows PowerShell
$env:DATA_DIR = "D:\my-flap-data"
flap

# Docker (already mapped)
docker run -e DATA_DIR=/app/data -v $(pwd):/app/data ...
```

## Troubleshooting

**"No providers configured"**
→ Run `flap config`

**"Port 4002 in use"**
→ `flap stop` then start again

**"Rate limit errors"**
→ Normal with free APIs. Proxy auto-switches. Add more providers.

**"All providers failed"**
→ Check your API keys are valid with `flap show`

## Architecture

- **CLI + Config**: Pure Node.js, zero runtime dependencies
- **SQLite Database**: Config, keys, rate limits, sessions (Node 22.5+ built-in)
- **Web Admin UI**: Built-in browser management at `/admin`
- **Model Catalog**: 238 static models + 764 synced from litellm
- **Model Auto-Discovery**: Probe provider `/v1/models` endpoints
- **Health Checker**: Real-time ping + quota extraction from rate limit headers
- **Proxy**: HTTP proxy with health-aware routing + sticky provider + failover
- **Multi-key**: Tries all keys per provider before failover
- **Circuit breaker**: Skips failing providers for 60s
- **Rate limiting**: SQLite-based RPM/RPD tracking per key
- **Status Dashboard**: Live terminal UI (`flap status`)
- **Reliability Analysis**: 10s analysis for most stable provider (`flap fiable`)

## Data Sources

This project integrates model data from multiple sources:

**Model Data**:
- **litellm Model Catalog** — Synced via `flap sync` from [litellm's model_prices_and_context_window.json](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json), containing 2800+ models with context windows, pricing, vision support, etc.
- **Static Model Catalog** — Built-in 238 curated models covering 25+ providers
- **Model Auto-Discovery** — Background probing of provider `/v1/models` endpoints
- **User Custom** — Admin UI supports adding custom providers and models

**Provider Information**: Provider names, endpoint URLs, and documentation links sourced from official docs and community-maintained lists.

## Acknowledgments

Thanks to the following open-source projects for inspiration and data:

- [freellmapi](https://github.com/tashfeenahmed/freellmapi) — Minimalist API key rotation and proxy implementation that inspired this project's health-aware routing and high-availability design
- [litellm](https://github.com/BerriAI/litellm) — Enterprise-grade LLM gateway with a community-driven model catalog providing comprehensive model metadata (context windows, pricing, vision flags). The core data source for model sync, and its architecture inspired advanced routing strategies.
- [free-coding-models](https://github.com/alexjm19/free-coding-models) — Original reference for the static model catalog and tier classification.
- [OpenRouter](https://openrouter.ai) — Excellent AI model aggregation platform that inspired model auto-discovery.
- All free AI providers — NVIDIA, Groq, Cerebras, SambaNova, Replicate, DeepInfra and many more, providing valuable free AI compute for developers.

## License

MIT — Use freely, modify freely, no warranty.

## Star History

<a href="https://www.star-history.com/?repos=liwoyuandiane%2Ffree-llm-api-provider">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liwoyuandiane/free-llm-api-provider&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liwoyuandiane/free-llm-api-provider&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liwoyuandiane/free-llm-api-provider&type=date&legend=top-left" />
 </picture>
</a>
