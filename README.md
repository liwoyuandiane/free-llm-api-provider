# free-llm-api-provider

<p align="center">
  <a href="https://www.npmjs.com/package/free-llm-api-provider">
    <img src="https://img.shields.io/npm/v/free-llm-api-provider.svg" alt="npm version">
  </a>
  <a href="https://www.npmjs.com/package/free-llm-api-provider">
    <img src="https://img.shields.io/npm/dw/free-llm-api-provider.svg" alt="npm downloads">
  </a>
  <a href="https://github.com/alexjm19/free-llm-api-provider/blob/main/LICENSE">
    <img src="https://img.shields.io/npm/l/free-llm-api-provider.svg" alt="MIT License">
  </a>
</p>

A **self-contained local LLM proxy** with **automatic failover** across 25+ free AI providers and 238 models. No external dependencies — install once, configure keys, forget about it.

> Stop managing API keys. Stop worrying about rate limits. Stop paying for AI.

## Why?

Free AI APIs break — rate limits, downtime, capacity issues. Your coding assistant dies mid-session.

**free-llm-api-provider** runs a local OpenAI-compatible proxy that automatically routes to the next available provider when one fails. Zero config after setup.

## What It Does

- **Health-aware routing**: Real-time ping monitoring routes to the healthiest provider instantly — no blind iteration
- **Auto-failover**: 429/500/timeout → switch provider automatically
- **Sticky provider**: Once a provider works, it keeps using it until it fails (faster response)
- **Multi-key support**: Add multiple keys for the same provider, tries them all before failing over
- **238 models** across 25 providers (NVIDIA, Groq, OpenRouter, Cerebras, etc.)
- **Tier-based routing**: `tier-splus` (elite) → `tier-b` (default), with health scores overriding tiers
- **Web Admin UI**: Browser-based management at `http://localhost:4002/admin` — manage providers, API keys, discover models
- **Real-time status dashboard**: `--status` shows live provider health, latency, and quota
- **10s reliability analysis**: `--fiable` finds the most stable provider right now
- **Auto-generated API key**: Cryptographically random key generated on first run
- **Model auto-discovery**: Discover new models from provider `/v1/models` endpoints via the admin UI
- **OpenAI-compatible**: Works with Cursor, VS Code, Claude Desktop, OpenCode, any client
- **Self-contained**: Built-in config manager + model catalog + health checker. No separate tools needed.
- **Zero dependencies**: Pure Node.js. No Python, no Docker required.

## Supported Providers

| # | Provider | Models | Free Tier | Env Var |
|---|----------|--------|-----------|---------|
| 1 | NVIDIA NIM | 46 | ~40 RPM (no CC) | `NVIDIA_API_KEY` |
| 2 | Groq | 8 | 30 RPM, 1K-14.4K/day | `GROQ_API_KEY` |
| 3 | Cerebras | 4 | 30 RPM, 1M tokens/day | `CEREBRAS_API_KEY` |
| 4 | OpenRouter | 25 | 50/day free, 1K/day with $10 | `OPENROUTER_API_KEY` |
| 5 | SambaNova | 13 | Dev tier generous | `SAMBANOVA_API_KEY` |
| 6 | Hyperbolic | 13 | $1 free credits | `HYPERBOLIC_API_KEY` |
| 7 | Cloudflare | 15 | 10K neurons/day | `CLOUDFLARE_API_TOKEN` |
| 8 | Google AI Studio | 6 | 14.4K/day | `GOOGLE_API_KEY` |
| 9 | ZAI | 7 | Generous quota | `ZAI_API_KEY` |
| 10 | Scaleway | 10 | 1M free tokens | `SCALEWAY_API_KEY` |
| 11 | SiliconFlow | 6 | 100/day + $1 credits | `SILICONFLOW_API_KEY` |
| 12 | + 14 more | | | |

## Quick Start

### 1. Install

```bash
npm install -g free-llm-api-provider
```

### 2. Configure API Keys (One-time)

```bash
free-llm-api-provider --config
```

Interactive wizard prompts for keys. Need only **one** to start. More = better failover.

**Recommended first key**: Groq — https://console.groq.com/keys (30 RPM, no credit card)

**You can also set keys via environment variables:**
```bash
export GROQ_API_KEY="your_key_here"
export NVIDIA_API_KEY="your_key_here"
export OPENROUTER_API_KEY="your_key_here"
```

**Multi-key support**: You can add multiple keys for the same provider:
```bash
# In the config wizard, add a key, then add another for the same provider
# The proxy will try all keys before failing over to the next provider
```

**Where are keys stored?**
- Config file: `~/.free-llm-api-provider.json` (outside project directory)
- Or via environment variables (env vars override config file)

**Server API Key**: On first run, the proxy generates a cryptographically random API key (`sk-<64 hex chars>`) and stores it in the config file. This key is used by AI clients to connect to the proxy. Override with `FLAP_API_KEY` environment variable.

### 3. Start Proxy

```bash
free-llm-api-provider
```

Proxy runs at `http://localhost:4002`.

### 4. Configure Your AI Client

| Client | Base URL | API Key |
|--------|----------|---------|
| Cursor | `http://localhost:4002/v1` | `sk-free-llm-api-provider` |
| VS Code | `http://localhost:4002/v1` | `sk-free-llm-api-provider` |
| Claude Desktop | `http://localhost:4002/v1` | `sk-free-llm-api-provider` |
| OpenCode | `http://localhost:4002/v1` | `sk-free-llm-api-provider` |

## CLI Commands

All commands work **with or without `--`**:

```bash
# Start proxy (default)
free-llm-api-provider
free-llm-api-provider start

# Interactive config wizard
free-llm-api-provider --config
free-llm-api-provider config

# Show current config
free-llm-api-provider --show
free-llm-api-provider show

# Real-time provider health dashboard (live updating)
free-llm-api-provider --status
free-llm-api-provider status

# 10-second reliability analysis (finds best provider right now)
free-llm-api-provider --fiable
free-llm-api-provider fiable

# List all 238 models
free-llm-api-provider --models
free-llm-api-provider models

# List S+ tier only
free-llm-api-provider --models --tier S+
free-llm-api-provider models --tier S+

# List models for specific provider
free-llm-api-provider --models --provider groq
free-llm-api-provider models --provider groq

# Stop / restart proxy
free-llm-api-provider --stop
free-llm-api-provider stop
free-llm-api-provider --restart
free-llm-api-provider restart

# View proxy logs
free-llm-api-provider --logs
free-llm-api-provider logs

# Test proxy health
free-llm-api-provider --test
free-llm-api-provider test

# Open admin web UI URL
free-llm-api-provider --admin
free-llm-api-provider admin
```

### Web Admin UI

When the proxy is running, open **http://localhost:4002/admin** in your browser:

- **Providers tab**: Enable/disable providers, add/remove API keys, test connections, discover models
- **Models tab**: View the static model catalog (238 models) alongside auto-discovered models
- **Health tab**: Real-time provider health scores, latency, and quota usage
- **Settings tab**: Regenerate the server API key, run health checks

The admin UI is served directly by the proxy — no separate server needed.

### API Key

On first run, the proxy automatically generates a **cryptographically random API key** (format: `sk-<64 hex chars>`). You can override it with the `FLAP_API_KEY` environment variable:

```bash
export FLAP_API_KEY="sk-your-custom-key-here"
```

The generated key is displayed when the proxy starts:

```
✅ Proxy started on http://localhost:4002
   🌐 Admin UI:  http://localhost:4002/admin
   🔑 API Key:   sk-d8eca3465befb4a3d623ec30fceb202c4512f03c24632268a25a09d3489713e1
```

You can also regnerate it from the admin UI (Settings tab) or via the API:

```bash
curl -X POST http://localhost:4002/api/admin/key/regenerate
```

### Model Auto-Discovery

Providers that expose a `/v1/models` endpoint can have their models auto-discovered. In the admin UI, click **"发现模型"** next to any configured provider. Discovered models are added to the `/v1/models` API response and can be used directly by model ID in chat completion requests.

Note: Most free AI providers do not expose a public `/v1/models` endpoint, so discovery may return empty results for many providers. The static catalog of 238 models covers the vast majority of use cases.

### Shortcuts with `flap` alias

After installation, you can also use the shorter `flap` command:

```bash
flap status          # Same as free-llm-api-provider --status
flap test            # Same as free-llm-api-provider --test
flap stop            # Same as free-llm-api-provider stop
flap restart         # Same as free-llm-api-provider restart
flap show            # Same as free-llm-api-provider --show
flap models          # Same as free-llm-api-provider --models
flap fiable          # Same as free-llm-api-provider --fiable
flap logs            # Same as free-llm-api-provider --logs
flap config          # Same as free-llm-api-provider --config
```

## API Usage

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4002/v1",
    api_key="sk-free-llm-api-provider"
)

response = client.chat.completions.create(
    model="tier-splus",  # or tier-s, tier-aplus, tier-a, tier-b
    messages=[{"role": "user", "content": "Write hello world in Rust"}]
)
print(response.choices[0].message.content)
```

### cURL

```bash
curl http://localhost:4002/v1/chat/completions \
  -H "Authorization: Bearer sk-free-llm-api-provider" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tier-splus",
    "messages": [{"role": "user", "content": "Hi"}]
  }'
```

## How Failover Works

### Health-Aware Routing (New)

The proxy continuously pings all providers in the background. Each request is routed to the **healthiest provider first** — no blind iteration.

```
Provider Health Scores (updated every 30s):
  Groq      → Score: 95, Latency: 198ms ✅
  Cerebras  → Score: 80, Latency: 299ms
  OpenRouter→ Score: 45, Latency: 1200ms (slow)

Request → Groq (healthiest) → SUCCESS ✓
```

If the healthiest fails, it tries the next in score order. If no health data exists yet, falls back to tier-based ordering.

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
Request N: OpenRouter fails → Try next provider → NVIDIA ✅
```

**Multi-key failover:**
```
Groq key 1 → 401 ❌
Groq key 2 → 429 ❌
Groq key 3 → 200 ✅  ← Stays here until it fails
```

Proxy handles retries + provider switching. Your client sees only success or final exhaust error.

## Model Tiers

Tiers based on SWE-bench scores (coding benchmark), replicated from free-coding-models:

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

Use tier aliases in requests: `tier-splus`, `tier-s`, `tier-aplus`, `tier-a`, `tier-aminus`, `tier-bplus`, `tier-b`

## Config File

Stored at `~/.free-llm-api-provider.json`:

```json
{
  "apiKeys": {
    "groq": ["gsk_key1", "gsk_key2"],
    "nvidia": "nvapi-key1",
    "openrouter": "sk-or-key1"
  },
  "providers": {
    "groq": { "enabled": true },
    "nvidia": { "enabled": true }
  }
}
```

**Priority order:**
1. Environment variables (highest priority)
2. Config file keys
3. Multiple keys per provider (tries all before failing over)

## Troubleshooting

**"No providers configured"**
→ Run `free-llm-api-provider --config`

**"Port 4002 in use"**
→ `free-llm-api-provider --stop` then start again

**"Rate limit errors"**
→ Normal with free APIs. Proxy auto-switches. Add more providers for better coverage.

**"All providers failed"**
→ Check your API keys are valid with `free-llm-api-provider --show`

## Architecture

- **CLI + Config**: Pure Node.js, zero runtime dependencies
- **Web Admin UI**: Browser-based management panel served by the proxy at `/admin`
- **Model Catalog**: 238 models with tiers, replicated from free-coding-models
- **Auto-Discovery**: Probe provider `/v1/models` endpoints to discover new models
- **Health Checker**: Real-time ping monitoring with quota extraction from rate limit headers (core from free-coding-models)
- **Proxy**: Node.js HTTP proxy with health-aware routing + sticky provider + failover
- **Multi-key**: Automatically tries all keys per provider before failover
- **Circuit breaker**: Temporarily skips failing providers
- **Status Dashboard**: Live terminal UI showing provider health (`--status`)
- **Reliability Analysis**: 10s analysis mode to find the most stable provider (`--fiable`)

## License

MIT — Use freely, modify freely, no warranty.

## Star History

<a href="https://www.star-history.com/?repos=alexjm19%2Ffree-llm-api-provider">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=alexjm19/free-llm-api-provider&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=alexjm19/free-llm-api-provider&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=alexjm19/free-llm-api-provider&type=date&legend=top-left" />
 </picture>
</a>
