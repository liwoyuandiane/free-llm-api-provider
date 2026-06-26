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
    <strong>中文</strong> ·
    <a href="README_EN.md">English</a>
  </sub>
</p>

<h1 align="center">free-llm-api-provider</h1>

<p align="center">
  <b>自带 25+ 免费 AI 提供商、238+ 模型的本地 LLM 代理，自动故障切换，零外部依赖。</b>
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
- **238+ 模型** — 覆盖 NVIDIA、Groq、OpenRouter、Cerebras 等 25+ 提供商
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
| 1 | NVIDIA NIM | 13 | ~40 RPM | `NVIDIA_API_KEY` |
| 2 | Groq | 8 | 30 RPM, 1K-14.4K/天 | `GROQ_API_KEY` |
| 3 | Cerebras | 4 | 30 RPM, 100万 token/天 | `CEREBRAS_API_KEY` |
| 4 | OpenRouter | 25 | 50/天 免费, 1K/天 ($10) | `OPENROUTER_API_KEY` |
| 5 | SambaNova | 13 | 开发版慷慨 | `SAMBANOVA_API_KEY` |
| 6 | Hyperbolic | 13 | $1 免费额度 | `HYPERBOLIC_API_KEY` |
| 7 | Cloudflare | 15 | 1万 neurons/天 | `CLOUDFLARE_API_TOKEN` |
| 8 | Google AI Studio | 6 | 14.4K/天 | `GOOGLE_API_KEY` |
| 9 | ZAI | 7 | 慷慨配额 | `ZAI_API_KEY` |
| 10 | Scaleway | 10 | 100万 免费 token | `SCALEWAY_API_KEY` |
| 11 | SiliconFlow | 6 | 100/天 + $1 额度 | `SILICONFLOW_API_KEY` |
| 12 | **GitHub Models** 🆕 | 7 | 有速率限制 | `GITHUB_TOKEN` |
| 13 | **Cohere** 🆕 | 4 | 有免费额度 | `COHERE_API_KEY` |
| 14 | **Reka** 🆕 | 3 | 有免费额度 | `REKA_API_KEY` |
| 15 | **Pollinations** 🆕 | 3 | 无需 Key | — |
| 16 | **LLM7** 🆕 | 4 | 无需 Key | — |
| 17 | + 10 个更多 | | | |

> 通过 `flap sync` 可同步 litellm 目录（790+ 个模型，18 个提供商）

## 快速开始

### 安装

```bash
npm install -g free-llm-api-provider
```

> 也可以直接用 `npx free-llm-api-provider` 无需安装，但建议全局安装以便使用 `flap` 快捷命令。

### 配置 API Key（只需一次）

```bash
flap config
```

交互式向导会引导你输入 Key。**只需要一个 Key 就能开始**，越多故障切换效果越好。

**推荐首选 Key**：Groq — https://console.groq.com/keys （30 RPM，无需信用卡）

**也可以设置环境变量：**
```bash
export GROQ_API_KEY="你的key"
export NVIDIA_API_KEY="你的key"
```

**多 Key 支持**：同一个提供商可以添加多个 Key：
```bash
# 在配置向导中添加多个 Key，失败时会逐个尝试再切提供商
```

**Key 存在哪里？**
- SQLite 数据库：`.data/data.db`（项目根目录下，所有数据都在这里）
- 默认端口：`4002`（可通过环境变量 `FLAP_PORT` 或 `PORT` 自定义）
- 或环境变量（环境变量优先级更高）

**服务器 API Key**：首次运行自动生成密码级随机 Key（`sk-<64位hex>`），存储在 SQLite 数据库。AI 客户端用它连接代理。可通过 `FLAP_API_KEY` 环境变量覆盖。

### 启动代理

```bash
flap
```

代理运行在 `http://localhost:4002`。

### Docker 部署

```bash
# 从 GitHub Container Registry 拉取
docker pull ghcr.io/liwoyuandiane/free-llm-api-provider:main

# 从任意目录运行（数据库保存在当前目录）
cd /你的工作目录
docker run -d \
  --name flap \
  -p 4002:4002 \
  -e DATA_DIR=/app/data \
  -e FLAP_API_KEY=你的key \
  -e FLAP_ADMIN_PASSWORD=admin密码 \
  -e GROQ_API_KEY=你的key \
  -v $(pwd):/app/data \
  ghcr.io/liwoyuandiane/free-llm-api-provider:main
```

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

基于 SWE-bench 编程基准测试评分（参考 free-coding-models）：

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

所有配置存储在 SQLite 数据库 `.data/data.db` 中。API Key 使用 AES-256-GCM 加密存储。

**优先级：**
1. 环境变量（最高）
2. SQLite 数据库
3. 多 Key 逐个尝试后再切换

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
- **模型目录**：238 个静态模型 + litellm 同步 764 个模型
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
- **静态模型目录** — 内置 238 个经过筛选的模型，覆盖 25+ 提供商的基础能力
- **模型自动发现** — 后台自动探测提供商 `/v1/models` 端点，发现并注册新模型
- **用户自定义** — 管理后台支持添加自定义提供商和模型

**提供商信息**：提供商名称、端点 URL、文档链接来自各官方文档和社区维护列表。

## 致谢

感谢以下开源项目对本项目的启发和帮助：

- [freellmapi](https://github.com/tashfeenahmed/freellmapi) — 极简的 API Key 轮换与代理实现，为本项目的健康感知路由和高可用设计提供了重要参考
- [litellm](https://github.com/BerriAI/litellm) — 企业级 LLM 网关，社区驱动的模型目录提供了详尽的模型元数据（上下文窗口、定价、视觉支持等），是本项目模型同步功能的核心数据来源，其架构设计也启发了本项目的高级路由策略
- [free-coding-models](https://github.com/alexjm19/free-coding-models) — 静态模型目录和等级分类的原始参考，为本项目初始 238 个模型提供了基础
- [OpenRouter](https://openrouter.ai) — 优秀的 AI 模型聚合平台，提供了模型自动发现的参考实现
- 所有免费 AI 提供商 — NVIDIA、Groq、Cerebras、SambaNova、Replicate、DeepInfra 等，为开发者提供了宝贵的免费 AI 算力

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
