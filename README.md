<!--
╔══════════════════════════════════════════════════════════════╗
║  free-llm-api-provider                                     ║
║  Local LLM proxy with auto-failover across 24 free providers ║
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
    <strong>中文</strong> ·
    <a href="README_EN.md">English</a>
  </sub>
</p>

<h1 align="center">free-llm-api-provider</h1>

<p align="center">
  <b>自带 24 个免费 AI 提供商、130+ 静态模型 + 2800+ 同步模型的本地 LLM 代理，自动故障切换，零外部依赖。</b>
  <br>
  装一次，配好 Key，就不用再操心了。
</p>

<hr>

<p align="center">
  <b>免费 AI API 总是不稳定</b> — 限流、宕机、容量不足，写到一半代码助手就挂了。
  <br>
  <b>free-llm-api-provider</b> 运行一个本地 OpenAI 兼容代理，自动路由到可用的提供商，全程无感。
</p>

<hr>

## 功能特性

- **健康感知路由** — 实时 Ping 监控，自动选最快的提供商
- **自动故障切换** — 429/500/超时 → 自动换下一个提供商
- **粘性路由** — 同一个提供商成功后持续使用，失败才切换（更快响应）
- **多 Key 支持** — 一个提供商配多个 Key，逐个尝试再切换
- **130+ 静态模型 + 2800+ 同步模型** — 覆盖 NVIDIA、Groq、OpenRouter、Cerebras 等 24 个提供商（通过 `flap sync` 从 litellm 同步）
- **等级路由** — `tier-splus`（旗舰）→ `tier-b`（默认），健康分覆盖等级
- **Web 管理后台** — `http://localhost:4002/admin` 浏览器管理 Provider、Key
- **实时状态面板** — `flap status` 显示实时健康、延时和配额
- **模型自动发现** — 后台自动发现提供商的新模型
- **自动生成 API Key** — 首次运行生成密码级随机 Key
- **OpenAI 兼容** — 支持 Cursor、VS Code、Claude Desktop、OpenCode 等
- **零外部依赖** — 纯 Node.js，无需 Python、无需 Docker（可选）
- **Docker 支持** — 一键部署，数据库保存在当前目录

## 支持的提供商

| # | 提供商 | 模型数 | 免费额度 | 环境变量 |
|---|--------|--------|----------|----------|
| 1 | NVIDIA NIM | 13 | ~40 RPM, 无需信用卡 | `NVIDIA_API_KEY` |
| 2 | Groq | 8 | 30-50 RPM, 无需信用卡 | `GROQ_API_KEY` |
| 3 | Cerebras | 4 | 30 RPM, 100万 token/天 | `CEREBRAS_API_KEY` |
| 4 | OpenRouter | 25 | 50/天免费 | `OPENROUTER_API_KEY` |
| 5 | Google AI Studio | 6 | 14.4K 请求/天 | `GOOGLE_API_KEY` |
| 6 | ZAI (智谱) | 7 | 慷慨免费配额 | `ZAI_API_KEY` |
| 7 | Cloudflare AI | 15 | 1万 neurons/天 | `CLOUDFLARE_API_TOKEN` |
| 8 | SiliconFlow | 6 | 100 请求/天 + $1 额度 | `SILICONFLOW_API_KEY` |
| 9 | OVHcloud AI | 8 | 2 请求/分/IP 免 Key | `OVH_AI_ENDPOINTS_ACCESS_TOKEN` |
| 10 | Mistral (Codestral) | 1 | 30 RPM, 2000/天 | `CODESTRAL_API_KEY` |
| 11 | Hugging Face | 2 | 约 $0.10/月免费额度 | `HUGGINGFACE_API_KEY` |
| 12 | GitHub Models | 7 | 有速率限制 | `GITHUB_TOKEN` |
| 13 | Cohere | 4 | 免费试用 | `COHERE_API_KEY` |
| 14 | Reka | 3 | 免费额度 | `REKA_API_KEY` |
| 15 | Ollama Cloud | 6 | 约 10-20M token/月 | `OLLAMA_API_KEY` |
| 16 | OpenCode Zen | 7 | 免费促销模型（轮换） | — |
| 17 | Pollinations | 3 | **无需 API Key** | — |
| 18 | LLM7 | 4 | **无需 API Key** | — |
| 19 | Kilo Gateway | 3 | **200/小时/IP（无需 Key）** | — |
| 20 | AI Horde | 0 | **社区驱动，匿名可用（慢）** | — |
| 21 | Agnes AI | 0 | 免费额度 | `AGNES_API_KEY` |
| 22 | Routeway | 0 | 免费额度 | `ROUTEWAY_API_KEY` |
| 23 | BazaarLink | 0 | 免费额度 | `BAZAARLINK_API_KEY` |
| 24 | AI Native Studio | 0 | 免费额度 | `AINATIVE_API_KEY` |

> 通过 `flap sync` 可同步 litellm 目录（2800+ 个模型，100+ 提供商映射）

## 快速开始

### 方式一：Docker 部署（推荐）

```bash
# 拉取镜像
docker pull ghcr.io/liwoyuandiane/free-llm-api-provider:main

# 启动（数据库保存在当前目录）
cd /你的工作目录
docker run -d \
  --name flap \
  -p 4002:4002 \
  -e DATA_DIR=/app/data \
  -e FLAP_ADMIN_PASSWORD=你的管理员密码 \
  -e GROQ_API_KEY=你的key \
  -v $(pwd):/app/data \
  ghcr.io/liwoyuandiane/free-llm-api-provider:main
```

启动后浏览器打开 **http://localhost:4002/admin**，用 `admin` / 你设置的密码 登录。

> **Docker Compose** 也支持：把上面的参数写到 `docker-compose.yml` 里，然后 `docker compose up -d`。

### 方式二：Node.js 直接运行

需要 **Node.js >= 22.5**（因为使用了内置的 `node:sqlite` 模块）。

```bash
# 克隆项目
git clone https://github.com/liwoyuandiane/free-llm-api-provider.git
cd free-llm-api-provider

# 启动代理
node src/cli.js
```

启动后浏览器打开 **http://localhost:4002/admin**，默认账号 `admin` / `admin123`。

> 也可以用 npm 全局安装：`npm install -g free-llm-api-provider`，然后用 `flap` 命令启动。

### 配置 API Key

启动后在管理后台「提供商」页面添加 API Key，或通过环境变量设置：

```bash
export GROQ_API_KEY="你的key"
export NVIDIA_API_KEY="你的key"
```

**推荐首选**：Groq — https://console.groq.com/keys（30 RPM，无需信用卡）

### 配置 AI 客户端

| 客户端 | 地址 | API Key |
|--------|------|---------|
| Cursor | `http://localhost:4002/v1` | 自动生成的 Key |
| VS Code | `http://localhost:4002/v1` | 同上 |
| Claude Desktop | `http://localhost:4002/v1` | 同上 |
| OpenCode | `http://localhost:4002/v1` | 同上 |

启动代理时会显示 API Key：
```
✅ Proxy started on http://localhost:4002
   🔑 API Key:   sk-你的服务端 API Key（首次启动自动生成）
```

也可以在管理后台（设置页）或通过 API 重新生成：
```bash
curl -X POST http://localhost:4002/api/admin/key/regenerate
```

## CLI 命令

所有命令都支持 `--` 前缀或不加：

```bash
# 启动代理（默认）
flap
flap start

# 交互式配置向导
flap config

# 查看当前配置
flap show

# 实时健康面板（终端交互界面）
flap status

# 10 秒可靠性分析（找出当前最稳的提供商）
flap fiable

# 列出所有模型
flap models

# 查看 S+ 等级模型
flap models --tier S+

# 查看某个提供商的模型
flap models --provider groq

# 同步 litellm 模型目录
flap sync

# 导出当前模型为 JSON
flap export-catalog --output ./catalog.json

# 停止 / 重启代理
flap stop
flap restart

# 查看日志
flap logs

# 测试代理健康
flap test
```

## Web 管理后台

代理运行后，浏览器打开 **http://localhost:4002/admin**

首次访问使用默认账号密码 `admin` / `admin123`，登录后会强制提示修改密码。也可通过 `FLAP_ADMIN_PASSWORD` 环境变量设置自定义密码。

- **提供商页** — 启用/禁用提供商，添加/删除 API Key，测试连接，发现模型
- **模型页** — 查看 238 个静态模型 + 自动发现的模型，设置等级，启用/禁用
- **测试页** — 在线测试聊天补全（Enter 发送，Ctrl+Enter 换行），响应底部显示提供商和模型名
- **健康页** — 实时提供商健康评分、延时、配额
- **统计页** — 请求统计、速率限制状态
- **自定义页** — 添加自定义提供商（任意 OpenAI 兼容 API）
- **设置页** — 重新生成 API Key、修改密码

管理后台由代理直接提供，无需额外服务。

## API 使用

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4002/v1",
    api_key="你的服务器API Key"
)

response = client.chat.completions.create(
    model="tier-splus",  # 或 tier-s, tier-aplus, tier-a, tier-b
    messages=[{"role": "user", "content": "用 Rust 写个 hello world"}]
)
print(response.choices[0].message.content)
```

### cURL

```bash
curl http://localhost:4002/v1/chat/completions \
  -H "Authorization: Bearer 你的服务器API Key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tier-splus",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

## 故障切换原理

### 健康感知路由

代理后台持续 Ping 所有提供商，请求**优先发给最健康的那一个**：

```
提供商健康分（每 30 秒更新）：
  Groq      → 得分: 95, 延迟: 198ms ✅
  Cerebras  → 得分: 80, 延迟: 299ms
  OpenRouter→ 得分: 45, 延迟: 1200ms (慢)

请求 → Groq（最健康）→ 成功 ✓
```

最健康的失败就按得分顺序尝试下一个。无健康数据时按等级排序回退。

### 传统故障切换（回退）

```
请求 → NVIDIA → 429 限流
     → Groq   → 500 错误
     → Cerebras → 成功 ✓
```

**粘性提供商优化：**
```
请求 1: 逐个尝试直到成功 → OpenRouter ✅
请求 2+: 直接用 OpenRouter（快！）
请求 N: OpenRouter 挂了 → 尝试下一个 → NVIDIA ✅
```

**多 Key 故障切换：**
```
Groq key 1 → 401 ❌
Groq key 2 → 429 ❌
Groq key 3 → 200 ✅  ← 停留在此直到失败
```

代理处理重试 + 提供商切换，客户端只看到成功或最终失败。

## 模型等级

模型等级分为三部分：

| 来源 | 数量 | SWE-bench 评分 | 更新方式 |
|------|------|-----------|----------|
| **静态模型** | 130+ 个 | ✅ 有 | 随代码更新 |
| **同步模型** | 797 个 | ❌ 无（自动分级） | 每 24 小时自动同步 litellm 目录 |
| **用户自定义** | 不限 | ✅ 手动设置 | 管理后台设置 |

**同步模型自动分级规则**：根据模型名称（如 claude、gpt-4、gemini 等）和上下文窗口大小，自动分配 S+ 到 C 等级。管理员可在管理后台手动调整。

**SWE-bench 评分**：目前仅静态模型带有 SWE-bench 评分。评分数据存储在 `swe-bench.json` 中，启动时自动同步到数据库。同步模型由于缺少 SWE-bench 数据，采用基于模型名称和上下文窗口的自动分级。

**等级含义：**

| 等级 | 得分 | 说明 |
|------|------|------|
| `S+` | 70%+ | 旗舰模型，适合复杂重构和架构决策 |
| `S`  | 60-70% | 优秀编码模型，大部分任务可靠 |
| `A+` | 50-60% | 非常强，旗舰模型的优秀替代 |
| `A`  | 40-50% | 稳定发挥，适合通用编码 |
| `A-` | 35-40% | 不错，可用于简单任务 |
| `B+` | 30-35% | 小脚本和简单任务够用 |
| `B`  | 20-30% | 入门级，默认回退等级 |
| `C`  | <20%   | 基础模型，仅作最后手段 |

请求中使用等级别名：`tier-splus`、`tier-s`、`tier-aplus`、`tier-a`、`tier-aminus`、`tier-bplus`、`tier-b`

## 数据存储

所有配置存储在 SQLite 数据库 `.data/data.db` 中。API Key 使用 AES-256-GCM 加密存储，加密密钥保存在 `.data/.env` 文件中。

**`.data/.env` 文件**：存储加密密钥和提供商 API Key，格式：
```
ENCRYPTION_KEY=abc123...
GROQ_API_KEY=gsk_...
NVIDIA_API_KEY=nvapi-...
```
> 环境变量优先级最高，`.env` 文件次之，数据库最后。

**优先级：**
1. 环境变量（最高）
2. `.data/.env` 文件
3. SQLite 数据库

## 数据目录

所有运行时数据都存储在项目根目录的 `.data/` 文件夹下，**只需备份 `data.db` 即可完整迁移**：

```
your-project/
├── .data/
│   └── data.db       ← SQLite 数据库（API Key、提供商配置、会话、限流等全部数据）
├── src/
├── ...
```

**通过 `DATA_DIR` 环境变量自定义路径：**

```bash
# Linux / macOS
export DATA_DIR=/path/to/my-data
flap

# Windows PowerShell
$env:DATA_DIR = "D:\my-flap-data"
flap

# Docker 容器（已自动映射）
docker run -e DATA_DIR=/app/data -v $(pwd):/app/data ...
```

## 常见问题

**"没有配置提供商"**
→ 运行 `flap config`

**"端口 4002 被占用"**
→ `flap stop` 再重新启动

**"限流错误"**
→ 免费 API 的正常现象，代理会自动切换。添加更多提供商效果更好。

**"所有提供商都失败了"**
→ 用 `flap show` 检查 API Key 是否有效

## 架构

- **CLI + 配置**：纯 Node.js，零运行时依赖
- **SQLite 数据库**：存储配置、Key、速率限制、会话等（`node:sqlite`，Node 22.5+）
- **Web 管理后台**：代理内置 `/admin`，浏览器管理
- **模型目录**：130+ 个静态模型 + litellm 同步模型
- **模型自动发现**：探测提供商 `/v1/models` 端点发现新模型
- **健康检查器**：实时 Ping + 限流头配额提取
- **代理**：HTTP 代理 + 健康路由 + 粘性提供商 + 故障切换
- **多 Key**：每个提供商自动尝试所有 Key 再切换
- **熔断器**：临时跳过失败提供商（60 秒冷却）
- **速率限制**：基于 SQLite 的 RPM/RPD 跟踪，按 Key 限流
- **状态面板**：终端实时 UI（`flap status`）
- **可靠性分析**：10 秒分析模式找出最稳定提供商（`flap fiable`）

## 数据来源

本项目整合了多个开源模型数据来源：

**模型数据**：
- **litellm 模型目录** — 通过 `flap sync` 从 [litellm 的 model_prices_and_context_window.json](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json) 同步，包含 2800+ 模型的上下文窗口、定价、视觉支持等信息
- **静态模型目录** — 内置 130+ 个经过筛选的模型，覆盖 24 个提供商的基础能力
- **模型自动发现** — 后台自动探测提供商 `/v1/models` 端点，发现并注册新模型
- **用户自定义** — 管理后台支持添加自定义提供商和模型

**提供商信息**：提供商名称、端点 URL、文档链接来自各官方文档和社区维护列表。

## 致谢

感谢以下开源项目对本项目的启发和帮助：

- [freellmapi](https://github.com/tashfeenahmed/freellmapi) — 极简的 API Key 轮换与代理实现，为本项目的健康感知路由和高可用设计提供了重要参考
- [litellm](https://github.com/BerriAI/litellm) — 企业级 LLM 网关，社区驱动的模型目录提供了详尽的模型元数据（上下文窗口、定价、视觉支持等），是本项目模型同步功能的核心数据来源，其架构设计也启发了本项目的高级路由策略
- [free-coding-models](https://github.com/alexjm19/free-coding-models) — 静态模型目录和等级分类的原始参考，为本项目初始 238 个模型提供了基础
- [OpenRouter](https://openrouter.ai) — 优秀的 AI 模型聚合平台，提供了模型自动发现的参考实现
- 所有免费 AI 提供商 — NVIDIA、Groq、Cerebras、OpenRouter 等，为开发者提供了宝贵的免费 AI 算力

## 许可证

MIT — 自由使用、自由修改，无担保。

## Star 历史

<a href="https://www.star-history.com/?repos=liwoyuandiane%2Ffree-llm-api-provider">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liwoyuandiane/free-llm-api-provider&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liwoyuandiane/free-llm-api-provider&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liwoyuandiane/free-llm-api-provider&type=date&legend=top-left" />
 </picture>
</a>
