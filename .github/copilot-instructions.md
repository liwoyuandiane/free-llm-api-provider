# Copilot Instructions for free-llm-api-provider

## Project Overview
Zero-dependency Node.js LLM proxy with automatic failover across 24 free AI providers. CLI alias `flap`. **Pure Node.js with no external dependencies** — just run `node src/cli.js`.

## Key Constraints
- **Zero dependencies**: `package.json` has empty `dependencies` object — never add external packages
- **Node 22.5+**: Required for `node:sqlite` built-in module
- **No build step**: Just run `node src/cli.js`
- **Data directory**: `.data/` contains SQLite database and configs (gitignored)
- **Port**: 4002 (proxy) + admin UI at `http://localhost:4002/admin`

## Common Commands
```bash
node src/cli.js          # Start proxy (default)
node src/cli.js config   # Interactive configuration wizard
node src/cli.js status   # Real-time health dashboard
node src/cli.js sync     # Sync models from litellm catalog
node src/cli.js models   # List available models
node src/cli.js stop     # Stop running proxy
```

**Note**: No test suite or linter exists in this project. The Dockerfile uses `node -c src/*.js` for syntax checking.

## Architecture

```
src/cli.js               CLI commands, process management
src/proxy.js             HTTP proxy + failover + tier routing
src/admin.js             Admin SPA + REST API (serves /admin)
src/db.js                SQLite database layer (node:sqlite)
src/config.js            Configuration file read/write
src/models.js            Model catalog (three-source merge)
src/proxy-agent.js       Zero-dependency proxy tunnel (SOCKS5/HTTP CONNECT)
src/health-checker.js    Real-time Ping monitoring
src/status-dashboard.js  Terminal health panel
src/sync.js              litellm catalog synchronization
```

## Key Technical Details

### Tier Routing System
- `TIER_ALIAS_MAP`: `tier-splus` → `S+`, `tier-s` → `S`, etc.
- `TIER_FALLBACK`: Fallback chain (A+ → A → B+ → B)
- `modelTiers` reads from **database** (not static), filters by tier
- `proxyFetch()` replaces `fetch()` for automatic proxy support via `HTTPS_PROXY`/`HTTP_PROXY` env vars

### Security Patterns
- **admin.js template escaping**: Use `jsesc()` for `onclick=` attributes, `esc()` for `innerHTML`
- **JSON embedding XSS**: After `JSON.stringify()`, always `.replace(/<\//g, '<\\/')`
- **Bearer Token**: Use `.slice(7)` not `.replace('Bearer ', '')`
- **API Keys**: Stored with AES-256-GCM encryption in SQLite

### Critical Functions
- `cleanRateLimits()`: Execute at most once per 60 seconds
- `forwardToProvider`: Use `proxyFetch()` + `AbortSignal.timeout()`
- **Request body limits**: Proxy side 1MB, admin side 512KB

## Development Notes
- **No npm install needed**: Zero dependencies means no package installation
- **SQLite required**: Node 22.5+ for `node:sqlite` module
- **Data directory**: `.data/` must exist and be writable
- **Proxy support**: Automatically uses system proxy settings
- **Model sync**: `flap sync` required to get latest models from litellm catalog
- **Admin auth**: Default password `admin/admin123` (set via `FLAP_ADMIN_PASSWORD`)
- **Git ignore**: `.data/`, `.env*`, `*.db*` files are ignored

## Code Architecture Notes
- **Zero-dependency proxy**: `src/proxy-agent.js` implements SOCKS5/HTTP CONNECT without external libs
- **Health monitoring**: Real-time ping checks with automatic failover
- **Model discovery**: 130+ static models + 2800+ sync models from litellm catalog
- **Request routing**: Tier-based routing (S+ → A → B → C) with sticky sessions
- **Admin UI**: Built-in SPA at `/admin` with real-time statistics
- **Security**: XSS protection via JSON escaping and template escaping

## Docker
```bash
# Build and run with Docker Compose
docker-compose up -d
# Data persists in `.data/` directory
```

## CI/CD
- GitHub Actions: Docker builds on push to main
- Release workflow triggers on version tags
- No linting or type checking configured (syntax check only via `node -c`)
