/**
 * Model Catalog
 * 
 * Replicated from free-coding-models sources.js
 * Contains all 238 models across 25 providers with tiers and metadata.
 */

// NVIDIA NIM — only models verified available on free tier (2026-06-26)
const nvidiaNim = [
  ['stepfun-ai/step-3.5-flash', 'Step 3.5 Flash', 'S+', '74.4%', '256k'],
  ['qwen/qwen3-next-80b-a3b-instruct', 'Qwen3 80B Instruct', 'S', '65.0%', '128k'],
  ['qwen/qwen3.5-397b-a17b', 'Qwen3.5 400B VLM', 'S', '68.0%', '128k'],
  ['openai/gpt-oss-120b', 'GPT OSS 120B', 'S', '60.0%', '128k'],
  ['meta/llama-4-maverick-17b-128e-instruct', 'Llama 4 Maverick', 'S', '62.0%', '1M'],
  ['mistralai/mistral-large-3-675b-instruct-2512', 'Mistral Large 675B', 'A+', '58.0%', '256k'],
  ['nvidia/llama-3.3-nemotron-super-49b-v1.5', 'Nemotron Super 49B', 'A', '49.0%', '128k'],
  ['nvidia/nemotron-3-nano-30b-a3b', 'Nemotron Nano 30B', 'A', '43.0%', '128k'],
  ['openai/gpt-oss-20b', 'GPT OSS 20B', 'A', '42.0%', '128k'],
  ['meta/llama-3.3-70b-instruct', 'Llama 3.3 70B', 'A-', '39.5%', '128k'],
  ['bytedance/seed-oss-36b-instruct', 'Seed OSS 36B', 'A-', '38.0%', '32k'],
  ['stockmark/stockmark-2-100b-instruct', 'Stockmark 100B', 'A-', '36.0%', '32k'],
  ['mistralai/ministral-14b-instruct-2512', 'Ministral 14B', 'B+', '34.0%', '32k'],
];

// Groq
const groq = [
  ['llama-3.3-70b-versatile', 'Llama 3.3 70B', 'A-', '39.5%', '128k'],
  ['meta-llama/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout', 'A', '44.0%', '131k'],
  ['llama-3.1-8b-instant', 'Llama 3.1 8B', 'B', '28.8%', '128k'],
  ['openai/gpt-oss-120b', 'GPT OSS 120B', 'S', '60.0%', '128k'],
  ['openai/gpt-oss-20b', 'GPT OSS 20B', 'A', '42.0%', '128k'],
  ['qwen/qwen3-32b', 'Qwen3 32B', 'A+', '50.0%', '131k'],
  ['groq/compound', 'Groq Compound', 'A', '45.0%', '131k'],
  ['groq/compound-mini', 'Groq Compound Mini', 'B+', '32.0%', '131k'],
];

// Cerebras
const cerebras = [
  ['gpt-oss-120b', 'GPT OSS 120B', 'S', '60.0%', '128k'],
  ['qwen-3-235b-a22b-instruct-2507', 'Qwen3 235B', 'S+', '70.0%', '128k'],
  ['llama3.1-8b', 'Llama 3.1 8B', 'B', '28.8%', '128k'],
  ['zai-glm-4.7', 'GLM 4.7', 'S+', '73.8%', '200k'],
];

// SambaNova
const sambanova = [
  ['MiniMax-M2.5', 'MiniMax M2.5', 'S+', '74.0%', '160k'],
  ['DeepSeek-R1-0528', 'DeepSeek R1 0528', 'S', '61.0%', '128k'],
  ['DeepSeek-V3.1', 'DeepSeek V3.1', 'S', '62.0%', '128k'],
  ['DeepSeek-V3-0324', 'DeepSeek V3 0324', 'S', '62.0%', '128k'],
  ['DeepSeek-V3.2', 'DeepSeek V3.2', 'S+', '73.1%', '128k'],
  ['Llama-4-Maverick-17B-128E-Instruct', 'Llama 4 Maverick', 'S', '62.0%', '1M'],
  ['gpt-oss-120b', 'GPT OSS 120B', 'S', '60.0%', '128k'],
  ['DeepSeek-V3.1-Terminus', 'DeepSeek V3.1 Term', 'S', '68.4%', '128k'],
  ['Qwen3-32B', 'Qwen3 32B', 'A+', '50.0%', '128k'],
  ['Qwen3-235B-A22B-Instruct-2507', 'Qwen3 235B Instruct 2507', 'S+', '70.0%', '64k'],
  ['DeepSeek-R1-Distill-Llama-70B', 'R1 Distill 70B', 'A', '43.9%', '128k'],
  ['Meta-Llama-3.3-70B-Instruct', 'Llama 3.3 70B', 'A-', '39.5%', '128k'],
  ['Meta-Llama-3.1-8B-Instruct', 'Llama 3.1 8B', 'B', '28.8%', '128k'],
];

// OpenRouter
const openrouter = [
  ['qwen/qwen3.6-plus:free', 'Qwen3.6 Plus', 'S+', '78.8%', '1M'],
  ['qwen/qwen3-coder:free', 'Qwen3 Coder 480B', 'S+', '70.6%', '262k'],
  ['minimax/minimax-m2.5:free', 'MiniMax M2.5', 'S+', '74.0%', '197k'],
  ['z-ai/glm-4.5-air:free', 'GLM 4.5 Air', 'S+', '72.0%', '131k'],
  ['stepfun/step-3.5-flash:free', 'Step 3.5 Flash', 'S+', '74.4%', '256k'],
  ['arcee-ai/trinity-large-preview:free', 'Arcee Trinity Large', 'S+', '60.0%', '131k'],
  ['xiaomi/mimo-v2-flash:free', 'MiMo V2 Flash', 'S+', '73.4%', '262k'],
  ['deepseek/deepseek-r1-0528:free', 'DeepSeek R1 0528', 'S', '61.0%', '164k'],
  ['nvidia/nemotron-3-super-120b-a12b:free', 'Nemotron 3 Super', 'A+', '56.0%', '262k'],
  ['qwen/qwen3-next-80b-a3b-instruct:free', 'Qwen3 80B Instruct', 'S', '65.0%', '131k'],
  ['arcee-ai/trinity-mini:free', 'Arcee Trinity Mini', 'A', '40.0%', '131k'],
  ['nvidia/nemotron-nano-12b-v2-vl:free', 'Nemotron Nano 12B VL', 'A', '20.0%', '128k'],
  ['nvidia/nemotron-nano-9b-v2:free', 'Nemotron Nano 9B', 'B+', '18.0%', '128k'],
  ['nousresearch/hermes-3-llama-3.1-405b:free', 'Hermes 3 405B', 'A', '44.0%', '131k'],
  ['openai/gpt-oss-120b:free', 'GPT OSS 120B', 'S', '60.0%', '131k'],
  ['openai/gpt-oss-20b:free', 'GPT OSS 20B', 'A', '42.0%', '131k'],
  ['nvidia/nemotron-3-nano-30b-a3b:free', 'Nemotron Nano 30B', 'A', '43.0%', '128k'],
  ['cognitivecomputations/dolphin-mistral-24b-venice-edition:free', 'Dolphin Mistral 24B', 'B+', '30.0%', '33k'],
  ['meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B', 'A-', '39.5%', '131k'],
  ['mistralai/mistral-small-3.1-24b-instruct:free', 'Mistral Small 3.1', 'B+', '30.0%', '128k'],
  ['google/gemma-3-27b-it:free', 'Gemma 3 27B', 'B', '22.0%', '131k'],
  ['google/gemma-3-12b-it:free', 'Gemma 3 12B', 'C', '15.0%', '131k'],
  ['qwen/qwen3-4b:free', 'Qwen3 4B', 'C', '15.0%', '41k'],
  ['google/gemma-3n-e4b-it:free', 'Gemma 3n E4B', 'C', '10.0%', '8k'],
  ['google/gemma-3-4b-it:free', 'Gemma 3 4B', 'C', '10.0%', '33k'],
];

// Hugging Face
const huggingface = [
  ['deepseek-ai/DeepSeek-V3-0324', 'DeepSeek V3 0324', 'S', '62.0%', '128k'],
  ['Qwen/Qwen2.5-Coder-32B-Instruct', 'Qwen2.5 Coder 32B', 'A', '46.0%', '32k'],
];

// Replicate
const replicate = [
  ['deepseek-ai/DeepSeek-V3-0324', 'DeepSeek V3 0324', 'S', '62.0%', '128k'],
  ['meta/llama-3.3-70b-instruct', 'Llama 3.3 70B', 'A-', '39.5%', '128k'],
];

// DeepInfra
const deepinfra = [
  ['nvidia/Nemotron-3-Super', 'Nemotron 3 Super', 'A+', '56.0%', '128k'],
  ['deepseek-ai/DeepSeek-V3-0324', 'DeepSeek V3 0324', 'S', '62.0%', '128k'],
  ['Qwen/Qwen3-235B-A22B', 'Qwen3 235B', 'S+', '70.0%', '128k'],
  ['meta-llama/Meta-Llama-3.1-70B-Instruct', 'Llama 3.1 70B', 'A-', '39.5%', '128k'],
];

// Fireworks
const fireworks = [
  ['accounts/fireworks/models/deepseek-v3', 'DeepSeek V3', 'S', '62.0%', '128k'],
  ['accounts/fireworks/models/deepseek-r1', 'DeepSeek R1', 'S', '61.0%', '128k'],
  ['accounts/fireworks/models/llama4-maverick-instruct-basic', 'Llama 4 Maverick', 'S', '62.0%', '1M'],
  ['accounts/fireworks/models/qwen3-235b-a22b', 'Qwen3 235B', 'S+', '70.0%', '128k'],
];

// Codestral
const codestral = [
  ['codestral-latest', 'Codestral', 'B+', '34.0%', '256k'],
];

// Hyperbolic
const hyperbolic = [
  ['qwen/qwen3-coder-480b-a35b-instruct', 'Qwen3 Coder 480B', 'S+', '70.6%', '256k'],
  ['deepseek-ai/DeepSeek-R1-0528', 'DeepSeek R1 0528', 'S', '61.0%', '128k'],
  ['moonshotai/Kimi-K2-Instruct', 'Kimi K2 Instruct', 'S', '65.8%', '131k'],
  ['openai/gpt-oss-120b', 'GPT OSS 120B', 'S', '60.0%', '128k'],
  ['Qwen/Qwen3-235B-A22B-Instruct-2507', 'Qwen3 235B 2507', 'S+', '70.0%', '262k'],
  ['Qwen/Qwen3-235B-A22B', 'Qwen3 235B', 'S+', '70.0%', '128k'],
  ['qwen/qwen3-next-80b-a3b-instruct', 'Qwen3 80B Instruct', 'S', '65.0%', '128k'],
  ['Qwen/Qwen3-Next-80B-A3B-Thinking', 'Qwen3 80B Thinking', 'S', '68.0%', '128k'],
  ['deepseek-ai/DeepSeek-V3-0324', 'DeepSeek V3 0324', 'S', '62.0%', '128k'],
  ['openai/gpt-oss-20b', 'GPT OSS 20B', 'A', '42.0%', '131k'],
  ['Qwen/Qwen2.5-Coder-32B-Instruct', 'Qwen2.5 Coder 32B', 'A', '46.0%', '32k'],
  ['meta-llama/Llama-3.3-70B-Instruct', 'Llama 3.3 70B', 'A-', '39.5%', '128k'],
  ['meta-llama/Meta-Llama-3.1-405B-Instruct', 'Llama 3.1 405B', 'A', '44.0%', '128k'],
];

// Scaleway
const scaleway = [
  ['devstral-2-123b-instruct-2512', 'Devstral 2 123B', 'S+', '72.2%', '256k'],
  ['qwen3.5-397b-a17b', 'Qwen3.5 400B VLM', 'S', '68.0%', '250k'],
  ['mistral/mistral-large-3-675b-instruct-2512', 'Mistral Large 675B', 'A+', '58.0%', '250k'],
  ['qwen3-235b-a22b-instruct-2507', 'Qwen3 235B', 'S+', '70.0%', '128k'],
  ['gpt-oss-120b', 'GPT OSS 120B', 'S', '60.0%', '131k'],
  ['qwen3-coder-30b-a3b-instruct', 'Qwen3 Coder 30B', 'A+', '55.0%', '32k'],
  ['holo2-30b-a3b', 'Holo2 30B', 'A+', '52.0%', '131k'],
  ['llama-3.3-70b-instruct', 'Llama 3.3 70B', 'A-', '39.5%', '128k'],
  ['deepseek-r1-distill-llama-70b', 'R1 Distill 70B', 'A', '43.9%', '128k'],
  ['mistral-small-3.2-24b-instruct-2506', 'Mistral Small 3.2', 'B+', '30.0%', '128k'],
];

// Google AI Studio
const googleai = [
  ['gemma-4-31b-it', 'Gemma 4 31B', 'B+', '45.0%', '256k'],
  ['gemma-4-26b-a4b-it', 'Gemma 4 26B MoE', 'B+', '42.0%', '256k'],
  ['gemma-3-27b-it', 'Gemma 3 27B', 'B', '22.0%', '128k'],
  ['gemma-3-12b-it', 'Gemma 3 12B', 'C', '15.0%', '128k'],
  ['gemma-4-e4b-it', 'Gemma 4 E4B', 'C', '12.0%', '128k'],
  ['gemma-3-4b-it', 'Gemma 3 4B', 'C', '10.0%', '128k'],
];

// ZAI
const zai = [
  ['zai/glm-5', 'GLM-5', 'S+', '77.8%', '128k'],
  ['zai/glm-4.7', 'GLM-4.7', 'S+', '73.8%', '200k'],
  ['zai/glm-4.7-flash', 'GLM-4.7-Flash', 'S', '59.2%', '200k'],
  ['zai/glm-4.5', 'GLM-4.5', 'S+', '75.0%', '128k'],
  ['zai/glm-4.5-air', 'GLM-4.5-Air', 'S+', '72.0%', '128k'],
  ['zai/glm-4.5-flash', 'GLM-4.5-Flash', 'S', '59.2%', '128k'],
  ['zai/glm-4.6', 'GLM-4.6', 'S+', '70.0%', '128k'],
];

// SiliconFlow
const siliconflow = [
  ['Qwen/Qwen3-Coder-480B-A35B-Instruct', 'Qwen3 Coder 480B', 'S+', '70.6%', '256k'],
  ['deepseek-ai/DeepSeek-V3.2', 'DeepSeek V3.2', 'S+', '73.1%', '128k'],
  ['Qwen/Qwen3-235B-A22B', 'Qwen3 235B', 'S+', '70.0%', '128k'],
  ['deepseek-ai/DeepSeek-R1', 'DeepSeek R1', 'S', '61.0%', '128k'],
  ['Qwen/Qwen3-Coder-30B-A3B-Instruct', 'Qwen3 Coder 30B', 'A+', '55.0%', '32k'],
  ['Qwen/Qwen2.5-Coder-32B-Instruct', 'Qwen2.5 Coder 32B', 'A', '46.0%', '32k'],
];

// Together AI
const together = [
  ['moonshotai/Kimi-K2.5', 'Kimi K2.5', 'S+', '76.8%', '128k'],
  ['MiniMaxAI/MiniMax-M2.5', 'MiniMax M2.5', 'S+', '80.2%', '228k'],
  ['zai-org/GLM-5', 'GLM-5', 'S+', '77.8%', '128k'],
  ['Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8', 'Qwen3 Coder 480B', 'S+', '70.6%', '256k'],
  ['deepseek-ai/DeepSeek-V3.2', 'DeepSeek V3.2', 'S+', '73.1%', '164k'],
  ['MiniMaxAI/MiniMax-M2.1', 'MiniMax M2.1', 'S+', '74.0%', '197k'],
  ['Qwen/Qwen3.5-397B-A17B', 'Qwen3.5 400B VLM', 'S', '68.0%', '250k'],
  ['deepseek-ai/DeepSeek-V3.1', 'DeepSeek V3.1', 'S', '62.0%', '164k'],
  ['deepseek-ai/DeepSeek-V3.1-Terminus', 'DeepSeek V3.1 Term', 'S', '68.4%', '164k'],
  ['deepseek-ai/DeepSeek-R1', 'DeepSeek R1', 'S', '61.0%', '164k'],
  ['openai/gpt-oss-120b', 'GPT OSS 120B', 'S', '60.0%', '131k'],
  ['Qwen/Qwen3-235B-A22B-Instruct-2507', 'Qwen3 235B 2507', 'S+', '70.0%', '131k'],
  ['MiniMaxAI/MiniMax-M2', 'MiniMax M2', 'S', '69.4%', '197k'],
  ['nvidia/Nemotron-3-Super-120B-A12B', 'Nemotron 3 Super', 'A+', '56.0%', '128k'],
  ['nvidia/Nemotron-3-Nano-30B-A3B', 'Nemotron Nano 30B', 'A', '43.0%', '262k'],
  ['Qwen/Qwen3-Coder-30B-A3B-Instruct', 'Qwen3 Coder 30B', 'A+', '55.0%', '160k'],
  ['meta-llama/Llama-4-Scout-17B-16E-Instruct', 'Llama 4 Scout', 'A', '44.0%', '328k'],
  ['openai/gpt-oss-20b', 'GPT OSS 20B', 'A', '42.0%', '131k'],
  ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B', 'A-', '39.5%', '128k'],
];

// Cloudflare
const cloudflare = [
  ['@cf/moonshotai/kimi-k2.5', 'Kimi K2.5', 'S+', '76.8%', '256k'],
  ['@cf/zhipu/glm-4.7-flash', 'GLM-4.7-Flash', 'S', '59.2%', '131k'],
  ['@cf/openai/gpt-oss-120b', 'GPT OSS 120B', 'S', '60.0%', '128k'],
  ['@cf/qwen/qwq-32b', 'QwQ 32B', 'A+', '50.0%', '131k'],
  ['@cf/meta/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout', 'A', '44.0%', '131k'],
  ['@cf/nvidia/nemotron-3-120b-a12b', 'Nemotron 3 Super', 'A+', '56.0%', '128k'],
  ['@cf/qwen/qwen3-30b-a3b-fp8', 'Qwen3 30B MoE', 'A', '45.0%', '128k'],
  ['@cf/qwen/qwen2.5-coder-32b-instruct', 'Qwen2.5 Coder 32B', 'A', '46.0%', '32k'],
  ['@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', 'R1 Distill 32B', 'A', '43.9%', '128k'],
  ['@cf/openai/gpt-oss-20b', 'GPT OSS 20B', 'A', '42.0%', '128k'],
  ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'Llama 3.3 70B', 'A-', '39.5%', '128k'],
  ['@cf/google/gemma-4-26b-a4b-it', 'Gemma 4 26B MoE', 'A-', '38.0%', '256k'],
  ['@cf/mistralai/mistral-small-3.1-24b-instruct', 'Mistral Small 3.1', 'B+', '30.0%', '128k'],
  ['@cf/ibm/granite-4.0-h-micro', 'Granite 4.0 Micro', 'B+', '30.0%', '128k'],
  ['@cf/meta/llama-3.1-8b-instruct', 'Llama 3.1 8B', 'B', '28.8%', '128k'],
];

// Perplexity
const perplexity = [
  ['sonar-reasoning-pro', 'Sonar Reasoning Pro', 'A+', '50.0%', '128k'],
  ['sonar-reasoning', 'Sonar Reasoning', 'A', '45.0%', '128k'],
  ['sonar-pro', 'Sonar Pro', 'B+', '32.0%', '128k'],
  ['sonar', 'Sonar', 'B', '25.0%', '128k'],
];

// Alibaba DashScope (Qwen)
const qwen = [
  ['qwen3.6-plus', 'Qwen3.6 Plus', 'S+', '78.8%', '1M'],
  ['qwen3-coder-plus', 'Qwen3 Coder Plus', 'S+', '69.6%', '256k'],
  ['qwen3-coder-480b-a35b-instruct', 'Qwen3 Coder 480B', 'S+', '70.6%', '256k'],
  ['qwen3.5-plus', 'Qwen3.5 Plus', 'S', '68.0%', '1M'],
  ['qwen3-coder-max', 'Qwen3 Coder Max', 'S', '67.0%', '256k'],
  ['qwen3-coder-next', 'Qwen3 Coder Next', 'S', '65.0%', '256k'],
  ['qwen3-235b-a22b-instruct', 'Qwen3 235B', 'S', '70.0%', '256k'],
  ['qwen3-next-80b-a3b-instruct', 'Qwen3 80B Instruct', 'S', '65.0%', '128k'],
  ['qwen3-32b', 'Qwen3 32B', 'A+', '50.0%', '128k'],
  ['qwen2.5-coder-32b-instruct', 'Qwen2.5 Coder 32B', 'A', '46.0%', '32k'],
  ['qwen3.5-flash', 'Qwen3.5 Flash', 'B+', '55.0%', '1M'],
];

// iFlow
const iflow = [
  ['TBStars2-200B-A13B', 'TBStars2 200B', 'S+', '77.8%', '128k'],
  ['deepseek-v3.2', 'DeepSeek V3.2', 'S+', '73.1%', '128k'],
  ['qwen3-coder-plus', 'Qwen3 Coder Plus', 'S+', '72.0%', '256k'],
  ['qwen3-235b-a22b-instruct', 'Qwen3 235B', 'S+', '70.0%', '256k'],
  ['deepseek-r1', 'DeepSeek R1', 'S+', '70.6%', '128k'],
  ['kimi-k2', 'Kimi K2', 'S', '65.8%', '128k'],
  ['kimi-k2-0905', 'Kimi K2 0905', 'S', '68.0%', '256k'],
  ['glm-4.6', 'GLM 4.6', 'S', '62.0%', '200k'],
  ['deepseek-v3', 'DeepSeek V3', 'S', '62.0%', '128k'],
  ['qwen3-32b', 'Qwen3 32B', 'A+', '50.0%', '128k'],
  ['qwen3-max', 'Qwen3 Max', 'A+', '55.0%', '256k'],
];

// Chutes AI
const chutes = [
  ['deepseek-ai/DeepSeek-R1', 'DeepSeek R1', 'S', '61.0%', '64k'],
  ['meta-llama/Llama-3.1-70B-Instruct', 'Llama 3.1 70B', 'A-', '39.5%', '128k'],
  ['Qwen/Qwen2.5-72B-Instruct', 'Qwen 2.5 72B', 'A', '42.0%', '32k'],
  ['Qwen/Qwen2.5-Coder-32B-Instruct', 'Qwen2.5 Coder 32B', 'A', '46.0%', '32k'],
];

// OVHcloud
const ovhcloud = [
  ['Qwen3-Coder-30B-A3B-Instruct', 'Qwen3 Coder 30B MoE', 'A+', '55.0%', '256k'],
  ['gpt-oss-120b', 'GPT OSS 120B', 'S', '60.0%', '131k'],
  ['gpt-oss-20b', 'GPT OSS 20B', 'A', '42.0%', '131k'],
  ['Meta-Llama-3_3-70B-Instruct', 'Llama 3.3 70B', 'A-', '39.5%', '131k'],
  ['Qwen3-32B', 'Qwen3 32B', 'A+', '50.0%', '32k'],
  ['DeepSeek-R1-Distill-Llama-70B', 'R1 Distill 70B', 'A-', '40.0%', '131k'],
  ['Mistral-Small-3.2-24B-Instruct-2506', 'Mistral Small 3.2', 'B+', '34.0%', '131k'],
  ['Llama-3.1-8B-Instruct', 'Llama 3.1 8B', 'B', '28.8%', '131k'],
];

// Rovo Dev CLI
const rovo = [
  ['anthropic/claude-sonnet-4.6', 'Claude Sonnet 4.6', 'S+', '75.0%', '200k'],
  ['anthropic/claude-opus-4.6', 'Claude Opus 4.6', 'S+', '80.0%', '200k'],
  ['openai/gpt-5.2', 'GPT-5.2', 'S+', '72.0%', '400k'],
  ['openai/gpt-5.2-codex', 'GPT-5.2 Codex', 'S+', '74.0%', '400k'],
  ['anthropic/claude-haiku-4.5', 'Claude Haiku 4.5', 'A+', '50.0%', '200k'],
];

// Gemini CLI
const gemini = [
  ['google/gemini-3.1-pro', 'Gemini 3.1 Pro', 'S+', '78.0%', '1M'],
  ['google/gemini-2.5-pro', 'Gemini 2.5 Pro', 'S+', '63.2%', '1M'],
  ['google/gemini-2.5-flash', 'Gemini 2.5 Flash', 'A+', '50.0%', '1M'],
];

// OpenCode Zen
const opencodeZen = [
  ['big-pickle', 'Big Pickle', 'S+', '72.0%', '200k'],
  ['mimo-v2-pro-free', 'MiMo V2 Pro Free', 'S+', '75.0%', '1M'],
  ['mimo-v2-flash-free', 'MiMo V2 Flash Free', 'S+', '73.4%', '262k'],
  ['mimo-v2-omni-free', 'MiMo V2 Omni Free', 'S+', '73.0%', '262k'],
  ['gpt-5-nano', 'GPT 5 Nano', 'S', '65.0%', '400k'],
  ['minimax-m2.5-free', 'MiniMax M2.5 Free', 'S+', '80.2%', '200k'],
  ['nemotron-3-super-free', 'Nemotron 3 Super Free', 'A+', '52.0%', '1M'],
];

// GitHub Models
const githubModels = [
  ['gpt-4o', 'GPT-4o', 'S+', '72.0%', '128k'],
  ['gpt-4o-mini', 'GPT-4o Mini', 'A+', '50.0%', '128k'],
  ['Meta-Llama-3.1-405B-Instruct', 'Llama 3.1 405B', 'A', '44.0%', '128k'],
  ['Meta-Llama-3.1-70B-Instruct', 'Llama 3.1 70B', 'A-', '39.5%', '128k'],
  ['Mistral-Large-2411', 'Mistral Large', 'A+', '58.0%', '128k'],
  ['Cohere-command-r-plus', 'Command R+', 'A', '45.0%', '128k'],
  ['Phi-3.5-MoE-instruct', 'Phi 3.5 MoE', 'B+', '32.0%', '128k'],
];

// Cohere
const cohereModels = [
  ['command-a', 'Command A', 'S', '65.0%', '256k'],
  ['command-r-plus', 'Command R+', 'A', '45.0%', '128k'],
  ['command-r', 'Command R', 'A-', '38.0%', '128k'],
  ['command-r7b-12-2024', 'Command R 7B', 'B', '28.0%', '128k'],
];

// Reka
const rekaModels = [
  ['reka-core-20250219', 'Reka Core', 'A+', '52.0%', '128k'],
  ['reka-flash-20250219', 'Reka Flash', 'A', '44.0%', '128k'],
  ['reka-edge-20250219', 'Reka Edge', 'B+', '30.0%', '128k'],
];

// Pollinations (free, no key required)
const pollinationsModels = [
  ['openai', 'GPT-4o (via Pollinations)', 'S+', '72.0%', '128k'],
  ['mistral', 'Mistral (via Pollinations)', 'A+', '58.0%', '128k'],
  ['llama', 'Llama (via Pollinations)', 'A', '44.0%', '128k'],
];

// LLM7 (anonymous, no key required)
const llm7Models = [
  ['gpt-4o', 'GPT-4o (via LLM7)', 'S+', '72.0%', '128k'],
  ['gpt-4o-mini', 'GPT-4o Mini (via LLM7)', 'A+', '50.0%', '128k'],
  ['claude-3-5-sonnet', 'Claude 3.5 Sonnet (via LLM7)', 'S+', '75.0%', '128k'],
  ['llama-3.1-70b', 'Llama 3.1 70B (via LLM7)', 'A-', '39.5%', '128k'],
];

// Sources map
const sources = {
  nvidia: { name: 'NVIDIA', url: 'https://integrate.api.nvidia.com/v1/chat/completions', models: nvidiaNim },
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', models: groq },
  cerebras: { name: 'Cerebras', url: 'https://api.cerebras.ai/v1/chat/completions', models: cerebras },
  googleai: { name: 'Google AI Studio', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', models: googleai },
  cloudflare: { name: 'Cloudflare AI', url: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions', models: cloudflare },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', models: openrouter },
  deepinfra: { name: 'DeepInfra', url: 'https://api.deepinfra.com/v1/openai/chat/completions', models: deepinfra },
  huggingface: { name: 'Hugging Face', url: 'https://router.huggingface.co/v1/chat/completions', models: huggingface },
  perplexity: { name: 'Perplexity', url: 'https://api.perplexity.ai/chat/completions', models: perplexity },
  sambanova: { name: 'SambaNova', url: 'https://api.sambanova.ai/v1/chat/completions', models: sambanova },
  fireworks: { name: 'Fireworks', url: 'https://api.fireworks.ai/inference/v1/chat/completions', models: fireworks },
  hyperbolic: { name: 'Hyperbolic', url: 'https://api.hyperbolic.xyz/v1/chat/completions', models: hyperbolic },
  ovhcloud: { name: 'OVHcloud AI', url: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions', models: ovhcloud },
  replicate: { name: 'Replicate', url: 'https://api.replicate.com/v1/predictions', models: replicate },
  codestral: { name: 'Codestral', url: 'https://api.mistral.ai/v1/chat/completions', models: codestral },
  zai: { name: 'ZAI', url: 'https://api.z.ai/api/coding/paas/v4/chat/completions', models: zai },
  scaleway: { name: 'Scaleway', url: 'https://api.scaleway.ai/v1/chat/completions', models: scaleway },
  qwen: { name: 'Alibaba DashScope', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', models: qwen },
  siliconflow: { name: 'SiliconFlow', url: 'https://api.siliconflow.com/v1/chat/completions', models: siliconflow },
  chutes: { name: 'Chutes AI', url: 'https://chutes.ai/v1/chat/completions', models: chutes },
  together: { name: 'Together AI', url: 'https://api.together.xyz/v1/chat/completions', models: together },
  iflow: { name: 'iFlow', url: 'https://apis.iflow.cn/v1/chat/completions', models: iflow, shutdownDate: '2026-04-17' },
  github: { name: 'GitHub Models', url: 'https://models.inference.ai.azure.com/chat/completions', models: githubModels },
  cohere: { name: 'Cohere', url: 'https://api.cohere.com/v2/chat', models: cohereModels },
  reka: { name: 'Reka', url: 'https://api.reka.ai/v1/chat/completions', models: rekaModels },
  pollinations: { name: 'Pollinations', url: 'https://text.pollinations.ai/openai/', models: pollinationsModels, noKeyRequired: true },
  llm7: { name: 'LLM7', url: 'https://api.llm7.io/v1/chat/completions', models: llm7Models, noKeyRequired: true },
  rovo: { name: 'Rovo Dev CLI', url: null, models: rovo, cliOnly: true },
  gemini: { name: 'Gemini CLI', url: null, models: gemini, cliOnly: true },
  'opencode-zen': { name: 'OpenCode Zen', url: 'https://opencode.ai/zen/v1/chat/completions', models: opencodeZen, zenOnly: true },
};

// Flat MODELS array with providerKey as 6th element
const MODELS = [];
for (const [sourceKey, sourceData] of Object.entries(sources)) {
  if (!sourceData || !sourceData.models) continue;
  for (const [modelId, label, tier, sweScore, ctx] of sourceData.models) {
    MODELS.push([modelId, label, tier, sweScore, ctx, sourceKey]);
  }
}

// Environment variable names per provider
// 部分提供商支持多个环境变量名（与 config.js 中的 ENV_VARS 保持一致）
const ENV_VAR_NAMES = {
  nvidia: 'NVIDIA_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  sambanova: 'SAMBANOVA_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  huggingface: 'HUGGINGFACE_API_KEY',  // 也支持 HF_TOKEN
  replicate: 'REPLICATE_API_TOKEN',
  deepinfra: 'DEEPINFRA_API_KEY',      // 也支持 DEEPINFRA_TOKEN
  fireworks: 'FIREWORKS_API_KEY',
  codestral: 'CODESTRAL_API_KEY',
  hyperbolic: 'HYPERBOLIC_API_KEY',
  scaleway: 'SCALEWAY_API_KEY',
  googleai: 'GOOGLE_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
  together: 'TOGETHER_API_KEY',
  cloudflare: 'CLOUDFLARE_API_TOKEN',  // 也支持 CLOUDFLARE_API_KEY
  perplexity: 'PERPLEXITY_API_KEY',    // 也支持 PPLX_API_KEY
  qwen: 'DASHSCOPE_API_KEY',
  zai: 'ZAI_API_KEY',
  iflow: 'IFLOW_API_KEY',
  chutes: 'CHUTES_API_KEY',
  ovhcloud: 'OVH_AI_ENDPOINTS_ACCESS_TOKEN',
  github: 'GITHUB_TOKEN',
  cohere: 'COHERE_API_KEY',
  reka: 'REKA_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

// Tier order for sorting (highest first)
const TIER_ORDER = ['S+', 'S', 'A+', 'A', 'A-', 'B+', 'B', 'C'];

// Helper: Get models by tier
function getModelsByTier(tier) {
  return MODELS.filter(m => m[2] === tier);
}

// Helper: Get models by provider (synced first, static as fallback)
// Synced models from litellm are more current; static catalog is the offline fallback.
function getModelsByProvider(providerKey) {
  const staticModels = MODELS.filter(m => m[5] === providerKey);
  // Include synced models from catalog (higher priority — more current)
  try {
    const { getSyncedModels } = require('./sync');
    const synced = getSyncedModels(providerKey);
    if (synced.length > 0) {
      // Synced models first, then static models that aren't in synced data
      const syncedIds = new Set(synced.map(m => m[0]));
      const merged = [];
      // Synced models (from litellm — most current)
      for (const sm of synced) {
        merged.push([sm[0], sm[1], sm[2], sm[3], sm[4], providerKey]);
      }
      // Static models not in synced data (offline fallback)
      for (const m of staticModels) {
        if (!syncedIds.has(m[0])) {
          merged.push(m);
        }
      }
      return merged;
    }
  } catch {}
  return staticModels;
}

// Helper: Get providers for a model
function getProviderForModel(modelId) {
  const found = MODELS.find(m => m[0] === modelId);
  return found ? found[5] : null;
}

// Helper: Check if a provider has passed its shutdown date
function isProviderShutdown(providerKey) {
  const src = sources[providerKey];
  if (!src || !src.shutdownDate) return false;
  try {
    return new Date() > new Date(src.shutdownDate);
  } catch {
    return false; // invalid date format — don't block
  }
}

// Helper: Get all providers that have API endpoints (not CLI-only, not zen-only, not shutdown)
function getApiProviders() {
  return Object.entries(sources)
    .filter(([key, data]) => data.url && !data.cliOnly && !data.zenOnly && !isProviderShutdown(key))
    .map(([key, _]) => key);
}

// Parse context window string to number of tokens
function parseCtxWindow(ctxStr) {
  if (!ctxStr) return 128000;
  const num = parseFloat(ctxStr);
  if (isNaN(num)) return 128000;
  if (ctxStr.includes('M')) return Math.round(num * 1000000);
  if (ctxStr.includes('k')) return Math.round(num * 1000);
  return num;
}

// Helper: Get model limits (context window, max output)
function getModelLimits(modelId) {
  const model = MODELS.find(m => m[0] === modelId);
  if (!model) return { context: 128000, output: 8192 };
  
  const context = parseCtxWindow(model[4]);
  const provider = model[5];
  
  // Provider-specific max output 查找表
  const OUTPUT_LIMITS = {
    openrouter: 32000,
    fireworks: 16384,
    groq: 8192,
    nvidia: 8192,
    cerebras: 8192,
    googleai: 8192,
    hyperbolic: 8192,
    zai: 8192,
    codestral: 8192,
    qwen: 8192,
    cloudflare: 4096,
    sambanova: 4096,
    together: 4096,
    deepinfra: 4096,
    scaleway: 4096,
    siliconflow: 4096,
    replicate: 4096,
    huggingface: 4096,
    perplexity: 4096,
    ovhcloud: 4096,
  };
  
  const output = OUTPUT_LIMITS[provider] !== undefined ? OUTPUT_LIMITS[provider] : 8192;
  
  return { context, output };
}

module.exports = {
  sources,
  MODELS,
  ENV_VAR_NAMES,
  TIER_ORDER,
  getModelsByTier,
  getModelsByProvider,
  getProviderForModel,
  getApiProviders,
  getModelLimits,
  parseCtxWindow,
  isProviderShutdown,
};
