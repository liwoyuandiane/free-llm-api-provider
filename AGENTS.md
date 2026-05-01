# AGENTS.md — free-llm-api-provider

## Project Overview

Self-contained Node.js CLI tool that runs a local OpenAI-compatible proxy with automatic failover across 25+ free LLM providers. Zero external dependencies. Published as `free-llm-api-provider` on npm.

**Entry point:** `src/cli.js` (also `src/proxy.js` when imported)
**CLI aliases:** `free-llm-api-provider` and `flap`
**Proxy URL:** `http://localhost:4000/v1/chat/completions`

## Critical Constraints

- **Zero dependencies** — `package.json.dependencies` is `{}`. Do NOT add npm packages. Use only Node.js built-ins.
- **No build step** — Direct `node src/cli.js`. No transpilation, bundling, or compilation.
- **Config lives outside repo** — `~/.free-llm-api-provider.json`. Never commit config or keys.
- **No tests** — There is no test suite. Verify manually by running the proxy and making requests.

## Architecture

```
src/cli.js           → CLI commands, config wizard, process management
src/proxy.js         → HTTP proxy server, request routing, failover logic
src/health-checker.js → Real-time provider ping with quota extraction
src/status-dashboard.js → Live terminal UI for provider health
src/models.js        → Static catalog of 238 models across 25 providers
src/config.js        → Config file I/O (~/.free-llm-api-provider.json)
src/providers.js     → Provider URL and metadata definitions
```

## Key Implementation Details

### Thinking Extraction (Critical)

The proxy extracts `<thought>` tags from streaming responses and moves them to `reasoning_content` field. This uses a **stateful parser** (`ThinkingExtractor` class) that accumulates chunks across SSE events because tags can be split across chunks.

- **Do not** modify the extractor unless you deeply understand SSE chunk boundaries
- **Do not** add regex-based extraction for streaming — it will break on split tags
- The extractor is instantiated per-request and must live for the full stream duration

### Health-Aware Routing

- Background health checker pings all configured providers every 30s
- Each provider gets a score (0-100) based on latency + success rate
- Routing picks the highest-scoring provider first, not just tier order
- Health scores override tier priority when data is available

### Failover Behavior

- **Sticky provider**: Once a provider succeeds, subsequent requests reuse it until it fails
- **Multi-key**: If a provider has multiple API keys, tries all before failing over
- **Circuit breaker**: After 3 consecutive failures, provider is skipped for 60s
- **Context-fit check**: Skips providers if estimated tokens exceed model context window

### Request Body Transformations

The proxy modifies incoming request bodies before forwarding:
- Removes `maxOutputTokens` (Google/Gemini format) — uses model's real `max_tokens` instead
- Removes `responseModalities`, `safetySettings`, `generationConfig`
- Maps `tier-*` aliases to actual model IDs
- **Never** modifies `tools` or `tool_choice` — passes through transparently

## Development Workflow

### Running Locally

```bash
# Install globally from local source
npm link

# Start proxy
flap
# or
node src/cli.js

# In another terminal, test
flap test
flap status      # Live dashboard
flap --fiable    # 10s reliability analysis
```

### Adding a New Provider

1. Add models to `src/models.js` in the appropriate provider array
2. Add provider metadata to `src/providers.js`
3. Add env var mapping to `src/config.js` (`ENV_VARS`)
4. Add ping logic to `src/health-checker.js` if provider has special headers/auth
5. Test manually: configure key, run proxy, verify routing

### Publishing

```bash
npm version patch   # or minor/major
npm publish
```

No build step. The `files` field in `package.json` controls what gets published (`src/`, `README.md`, `LICENSE`).

## Common Gotchas

- **Groq tool calls**: Models in the Llama family often fail with 400 `tool_use_failed` when doing function calling. The proxy handles this via failover to other providers.
- **Streaming SSE format**: Chunks must start with `data: ` and end with `\n\n`. The proxy normalizes provider responses to this format.
- **Windows line endings**: Git may warn about LF→CRLF conversion. This is harmless.
- **Port 4000 conflicts**: If port is in use, `flap stop` then restart.

## Environment Variables

Keys can be set via env vars (highest priority) or config file. See `src/config.js` `ENV_VARS` for the full mapping. Common ones:

- `GROQ_API_KEY`
- `NVIDIA_API_KEY`
- `OPENROUTER_API_KEY`
- `GOOGLE_API_KEY`
- `CEREBRAS_API_KEY`

## Verification Checklist

Before committing changes:
- [ ] No API keys in code (run `grep -r "sk-" src/`)
- [ ] `npm pack --dry-run` includes only intended files
- [ ] Manual test: `node src/cli.js --test` returns 200
- [ ] No new dependencies added to package.json
