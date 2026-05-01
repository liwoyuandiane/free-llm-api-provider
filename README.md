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

- **Auto-failover**: 429/500/timeout → switch provider automatically
- **Sticky provider**: Once a provider works, it keeps using it until it fails (faster response)
- **Multi-key support**: Add multiple keys for the same provider, tries them all before failing over
- **238 models** across 25 providers (NVIDIA, Groq, OpenRouter, Cerebras, etc.)
- **Tier-based routing**: `tier-splus` (elite) → `tier-b` (default)
- **OpenAI-compatible**: Works with Cursor, VS Code, Claude Desktop, OpenCode, any client
- **Self-contained**: Built-in config manager + model catalog. No separate tools needed.
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

### 3. Start Proxy

```bash
free-llm-api-provider
```

Proxy runs at `http://localhost:4000`.

### 4. Configure Your AI Client

| Client | Base URL | API Key |
|--------|----------|---------|
| Cursor | `http://localhost:4000/v1` | `sk-free-llm-api-provider` |
| VS Code | `http://localhost:4000/v1` | `sk-free-llm-api-provider` |
| Claude Desktop | `http://localhost:4000/v1` | `sk-free-llm-api-provider` |
| OpenCode | `http://localhost:4000/v1` | `sk-free-llm-api-provider` |

## CLI Commands

```bash
# Start proxy (default)
free-llm-api-provider

# Interactive config wizard
free-llm-api-provider --config

# Show current config
free-llm-api-provider --show

# List all 238 models
free-llm-api-provider --models

# List S+ tier only
free-llm-api-provider --models --tier S+

# List models for specific provider
free-llm-api-provider --models --provider groq

# Stop / restart proxy
free-llm-api-provider --stop
free-llm-api-provider --restart

# View proxy logs
free-llm-api-provider --logs

# Test proxy health
free-llm-api-provider --test
```

## API Usage

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4000/v1",
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
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-free-llm-api-provider" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tier-splus",
    "messages": [{"role": "user", "content": "Hi"}]
  }'
```

## How Failover Works

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

Proxy handles retries + provider switching. Your client sees only success or final exhaust error.

**Multi-key failover:**
```
Groq key 1 → 401 ❌
Groq key 2 → 429 ❌
Groq key 3 → 200 ✅  ← Stays here until it fails
```

## Model Tiers

| Tier | SWE-bench | Best For |
|------|-----------|----------|
| `tier-splus` | 70%+ | Complex refactors, frontier coding |
| `tier-s` | 60-70% | Most coding tasks |
| `tier-aplus` | 50-60% | Solid alternatives |
| `tier-a` | 40-50% | Good general use |
| `tier-aminus` | 35-40% | Decent backup |
| `tier-bplus` | 30-35% | Smaller tasks |
| `tier-b` | 20-30% | Default fallback |

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

**"Port 4000 in use"**
→ `free-llm-api-provider --stop` then start again

**"Rate limit errors"**
→ Normal with free APIs. Proxy auto-switches. Add more providers for better coverage.

**"All providers failed"**
→ Check your API keys are valid with `free-llm-api-provider --show`

## Architecture

- **CLI + Config**: Pure Node.js, zero runtime dependencies
- **Model Catalog**: 238 models with tiers, replicated from free-coding-models
- **Proxy**: Node.js HTTP proxy with sticky provider + failover
- **Multi-key**: Automatically tries all keys per provider before failover
- **Circuit breaker**: Temporarily skips failing providers

## License

MIT — Use freely, modify freely, no warranty.

## Star History

<a href="https://star-history.com/#alexjm19/free-llm-api-provider">
  <img src="https://api.star-history.com/svg?repos=alexjm19/free-llm-api-provider&type=Date" alt="Star History">
</a>
