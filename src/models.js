/**
 * Model Catalog
 *
 * Static model catalog — tiers stored in swe-bench.json and synced by syncSweBenchScores().
 * This file only provides model ID, display name, and context window for offline fallback.
 */

// NVIDIA NIM
const nvidiaNim = [
  ['stepfun-ai/step-3.5-flash', 'Step 3.5 Flash', '256k'],
  ['qwen/qwen3-next-80b-a3b-instruct', 'Qwen3 80B Instruct', '128k'],
  ['qwen/qwen3.5-397b-a17b', 'Qwen3.5 400B VLM', '128k'],
  ['openai/gpt-oss-120b', 'GPT OSS 120B', '128k'],
  ['meta/llama-4-maverick-17b-128e-instruct', 'Llama 4 Maverick', '1M'],
  ['mistralai/mistral-large-3-675b-instruct-2512', 'Mistral Large 675B', '256k'],
  ['nvidia/llama-3.3-nemotron-super-49b-v1.5', 'Nemotron Super 49B', '128k'],
  ['nvidia/nemotron-3-nano-30b-a3b', 'Nemotron Nano 30B', '128k'],
  ['openai/gpt-oss-20b', 'GPT OSS 20B', '128k'],
  ['meta/llama-3.3-70b-instruct', 'Llama 3.3 70B', '128k'],
  ['bytedance/seed-oss-36b-instruct', 'Seed OSS 36B', '32k'],
  ['stockmark/stockmark-2-100b-instruct', 'Stockmark 100B', '32k'],
  ['mistralai/ministral-14b-instruct-2512', 'Ministral 14B', '32k'],
];

// Groq
const groq = [
  ['llama-3.3-70b-versatile', 'Llama 3.3 70B', '128k'],
  ['meta-llama/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout', '131k'],
  ['llama-3.1-8b-instant', 'Llama 3.1 8B', '128k'],
  ['openai/gpt-oss-120b', 'GPT OSS 120B', '128k'],
  ['openai/gpt-oss-20b', 'GPT OSS 20B', '128k'],
  ['qwen/qwen3-32b', 'Qwen3 32B', '131k'],
  ['groq/compound', 'Groq Compound', '131k'],
  ['groq/compound-mini', 'Groq Compound Mini', '131k'],
];

// Cerebras
const cerebras = [
  ['gpt-oss-120b', 'GPT OSS 120B', '128k'],
  ['qwen-3-235b-a22b-instruct-2507', 'Qwen3 235B', '128k'],
  ['llama3.1-8b', 'Llama 3.1 8B', '128k'],
  ['zai-glm-4.7', 'GLM 4.7', '200k'],
];

// OpenRouter
const openrouter = [
  ['qwen/qwen3.6-plus:free', 'Qwen3.6 Plus', '1M'],
  ['qwen/qwen3-coder:free', 'Qwen3 Coder 480B', '262k'],
  ['minimax/minimax-m2.5:free', 'MiniMax M2.5', '197k'],
  ['z-ai/glm-4.5-air:free', 'GLM 4.5 Air', '131k'],
  ['stepfun/step-3.5-flash:free', 'Step 3.5 Flash', '256k'],
  ['arcee-ai/trinity-large-preview:free', 'Arcee Trinity Large', '131k'],
  ['xiaomi/mimo-v2-flash:free', 'MiMo V2 Flash', '262k'],
  ['deepseek/deepseek-r1-0528:free', 'DeepSeek R1 0528', '164k'],
  ['nvidia/nemotron-3-super-120b-a12b:free', 'Nemotron 3 Super', '262k'],
  ['qwen/qwen3-next-80b-a3b-instruct:free', 'Qwen3 80B Instruct', '131k'],
  ['arcee-ai/trinity-mini:free', 'Arcee Trinity Mini', '131k'],
  ['nvidia/nemotron-nano-12b-v2-vl:free', 'Nemotron Nano 12B VL', '128k'],
  ['nvidia/nemotron-nano-9b-v2:free', 'Nemotron Nano 9B', '128k'],
  ['nousresearch/hermes-3-llama-3.1-405b:free', 'Hermes 3 405B', '131k'],
  ['openai/gpt-oss-120b:free', 'GPT OSS 120B', '131k'],
  ['openai/gpt-oss-20b:free', 'GPT OSS 20B', '131k'],
  ['nvidia/nemotron-3-nano-30b-a3b:free', 'Nemotron Nano 30B', '128k'],
  ['cognitivecomputations/dolphin-mistral-24b-venice-edition:free', 'Dolphin Mistral 24B', '33k'],
  ['meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B', '131k'],
  ['mistralai/mistral-small-3.1-24b-instruct:free', 'Mistral Small 3.1', '128k'],
  ['google/gemma-3-27b-it:free', 'Gemma 3 27B', '131k'],
  ['google/gemma-3-12b-it:free', 'Gemma 3 12B', '131k'],
  ['qwen/qwen3-4b:free', 'Qwen3 4B', '41k'],
  ['google/gemma-3n-e4b-it:free', 'Gemma 3n E4B', '8k'],
  ['google/gemma-3-4b-it:free', 'Gemma 3 4B', '33k'],
];

// Hugging Face
const huggingface = [
  ['deepseek-ai/DeepSeek-V3-0324', 'DeepSeek V3 0324', '128k'],
  ['Qwen/Qwen2.5-Coder-32B-Instruct', 'Qwen2.5 Coder 32B', '32k'],
];

// Codestral (Mistral)
const codestral = [
  ['codestral-latest', 'Codestral', '256k'],
];

// Google AI Studio
const googleai = [
  ['gemma-4-31b-it', 'Gemma 4 31B', '256k'],
  ['gemma-4-26b-a4b-it', 'Gemma 4 26B MoE', '256k'],
  ['gemma-3-27b-it', 'Gemma 3 27B', '128k'],
  ['gemma-3-12b-it', 'Gemma 3 12B', '128k'],
  ['gemma-4-e4b-it', 'Gemma 4 E4B', '128k'],
  ['gemma-3-4b-it', 'Gemma 3 4B', '128k'],
];

// ZAI (Zhipu AI)
const zai = [
  ['zai/glm-5', 'GLM-5', '128k'],
  ['zai/glm-4.7', 'GLM-4.7', '200k'],
  ['zai/glm-4.7-flash', 'GLM-4.7-Flash', '200k'],
  ['zai/glm-4.5', 'GLM-4.5', '128k'],
  ['zai/glm-4.5-air', 'GLM-4.5-Air', '128k'],
  ['zai/glm-4.5-flash', 'GLM-4.5-Flash', '128k'],
  ['zai/glm-4.6', 'GLM-4.6', '128k'],
];

// SiliconFlow
const siliconflow = [
  ['Qwen/Qwen3-Coder-480B-A35B-Instruct', 'Qwen3 Coder 480B', '256k'],
  ['deepseek-ai/DeepSeek-V3.2', 'DeepSeek V3.2', '128k'],
  ['Qwen/Qwen3-235B-A22B', 'Qwen3 235B', '128k'],
  ['deepseek-ai/DeepSeek-R1', 'DeepSeek R1', '128k'],
  ['Qwen/Qwen3-Coder-30B-A3B-Instruct', 'Qwen3 Coder 30B', '32k'],
  ['Qwen/Qwen2.5-Coder-32B-Instruct', 'Qwen2.5 Coder 32B', '32k'],
];

// Cloudflare
const cloudflare = [
  ['@cf/moonshotai/kimi-k2.5', 'Kimi K2.5', '256k'],
  ['@cf/zhipu/glm-4.7-flash', 'GLM-4.7-Flash', '131k'],
  ['@cf/openai/gpt-oss-120b', 'GPT OSS 120B', '128k'],
  ['@cf/qwen/qwq-32b', 'QwQ 32B', '131k'],
  ['@cf/meta/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout', '131k'],
  ['@cf/nvidia/nemotron-3-120b-a12b', 'Nemotron 3 Super', '128k'],
  ['@cf/qwen/qwen3-30b-a3b-fp8', 'Qwen3 30B MoE', '128k'],
  ['@cf/qwen/qwen2.5-coder-32b-instruct', 'Qwen2.5 Coder 32B', '32k'],
  ['@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', 'R1 Distill 32B', '128k'],
  ['@cf/openai/gpt-oss-20b', 'GPT OSS 20B', '128k'],
  ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'Llama 3.3 70B', '128k'],
  ['@cf/google/gemma-4-26b-a4b-it', 'Gemma 4 26B MoE', '256k'],
  ['@cf/mistralai/mistral-small-3.1-24b-instruct', 'Mistral Small 3.1', '128k'],
  ['@cf/ibm/granite-4.0-h-micro', 'Granite 4.0 Micro', '128k'],
  ['@cf/meta/llama-3.1-8b-instruct', 'Llama 3.1 8B', '128k'],
];

// OVHcloud
const ovhcloud = [
  ['Qwen3-Coder-30B-A3B-Instruct', 'Qwen3 Coder 30B MoE', '256k'],
  ['gpt-oss-120b', 'GPT OSS 120B', '131k'],
  ['gpt-oss-20b', 'GPT OSS 20B', '131k'],
  ['Meta-Llama-3_3-70B-Instruct', 'Llama 3.3 70B', '131k'],
  ['Qwen3-32B', 'Qwen3 32B', '32k'],
  ['DeepSeek-R1-Distill-Llama-70B', 'R1 Distill 70B', '131k'],
  ['Mistral-Small-3.2-24B-Instruct-2506', 'Mistral Small 3.2', '131k'],
  ['Llama-3.1-8B-Instruct', 'Llama 3.1 8B', '131k'],
];

// OpenCode Zen
const opencodeZen = [
  ['big-pickle', 'Big Pickle', '200k'],
  ['mimo-v2-pro-free', 'MiMo V2 Pro Free', '1M'],
  ['mimo-v2-flash-free', 'MiMo V2 Flash Free', '262k'],
  ['mimo-v2-omni-free', 'MiMo V2 Omni Free', '262k'],
  ['gpt-5-nano', 'GPT 5 Nano', '400k'],
  ['minimax-m2.5-free', 'MiniMax M2.5 Free', '200k'],
  ['nemotron-3-super-free', 'Nemotron 3 Super Free', '1M'],
];

// GitHub Models
const githubModels = [
  ['gpt-4o', 'GPT-4o', '128k'],
  ['gpt-4o-mini', 'GPT-4o Mini', '128k'],
  ['Meta-Llama-3.1-405B-Instruct', 'Llama 3.1 405B', '128k'],
  ['Meta-Llama-3.1-70B-Instruct', 'Llama 3.1 70B', '128k'],
  ['Mistral-Large-2411', 'Mistral Large', '128k'],
  ['Cohere-command-r-plus', 'Command R+', '128k'],
  ['Phi-3.5-MoE-instruct', 'Phi 3.5 MoE', '128k'],
];

// Cohere
const cohereModels = [
  ['command-a', 'Command A', '256k'],
  ['command-r-plus', 'Command R+', '128k'],
  ['command-r', 'Command R', '128k'],
  ['command-r7b-12-2024', 'Command R 7B', '128k'],
];

// Reka
const rekaModels = [
  ['reka-core-20250219', 'Reka Core', '128k'],
  ['reka-flash-20250219', 'Reka Flash', '128k'],
  ['reka-edge-20250219', 'Reka Edge', '128k'],
];

// Pollinations (free, no key required)
const pollinationsModels = [
  ['openai', 'GPT-4o (via Pollinations)', '128k'],
  ['mistral', 'Mistral (via Pollinations)', '128k'],
  ['llama', 'Llama (via Pollinations)', '128k'],
];

// LLM7 (anonymous, no key required)
const llm7Models = [
  ['gpt-4o', 'GPT-4o (via LLM7)', '128k'],
  ['gpt-4o-mini', 'GPT-4o Mini (via LLM7)', '128k'],
  ['claude-3-5-sonnet', 'Claude 3.5 Sonnet (via LLM7)', '128k'],
  ['llama-3.1-70b', 'Llama 3.1 70B (via LLM7)', '128k'],
];

// New providers
const ollamaCloud = [
  ['qwen3-coder:480b', 'Qwen3-Coder 480B', '262k'],
  ['qwen3-coder-next', 'Qwen3-Coder Next', '262k'],
  ['glm-4.7', 'GLM-4.7', '131k'],
  ['gpt-oss:120b', 'GPT-OSS 120B', '131k'],
  ['gpt-oss:20b', 'GPT-OSS 20B', '131k'],
  ['gemma4:31b', 'Gemma 4 31B', '131k'],
];

const kiloGateway = [
  ['poolside/laguna-m.1:free', 'Poolside Laguna M.1', '262k'],
  ['stepfun/step-3.7-flash:free', 'StepFun Step 3.7 Flash', '262k'],
  ['nvidia/nemotron-3-super-120b-a12b:free', 'Nemotron 3 Super 120B', '262k'],
];

const agnesAi = [];
const routeway = [];
const bazaarlink = [];
const ainativeStudio = [];
const aihorde = [];

// Sources map
const sources = {
  nvidia: { name: 'NVIDIA', url: 'https://integrate.api.nvidia.com/v1/chat/completions', models: nvidiaNim },
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', models: groq },
  cerebras: { name: 'Cerebras', url: 'https://api.cerebras.ai/v1/chat/completions', models: cerebras },
  googleai: { name: 'Google AI Studio', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', models: googleai },
  cloudflare: { name: 'Cloudflare AI', url: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions', models: cloudflare },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', models: openrouter },
  huggingface: { name: 'Hugging Face', url: 'https://router.huggingface.co/v1/chat/completions', models: huggingface },
  ovhcloud: { name: 'OVHcloud AI', url: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions', models: ovhcloud },
  codestral: { name: 'Mistral', url: 'https://api.mistral.ai/v1/chat/completions', models: codestral },
  zai: { name: 'ZAI', url: 'https://api.z.ai/api/coding/paas/v4/chat/completions', models: zai },
  siliconflow: { name: 'SiliconFlow', url: 'https://api.siliconflow.com/v1/chat/completions', models: siliconflow },
  github: { name: 'GitHub Models', url: 'https://models.inference.ai.azure.com/chat/completions', models: githubModels },
  cohere: { name: 'Cohere', url: 'https://api.cohere.com/v2/chat/completions', models: cohereModels },
  reka: { name: 'Reka', url: 'https://api.reka.ai/v1/chat/completions', models: rekaModels },
  pollinations: { name: 'Pollinations', url: 'https://text.pollinations.ai/openai/', models: pollinationsModels, noKeyRequired: true },
  llm7: { name: 'LLM7', url: 'https://api.llm7.io/v1/chat/completions', models: llm7Models, noKeyRequired: true },
  'opencode-zen': { name: 'OpenCode Zen', url: 'https://opencode.ai/zen/v1/chat/completions', models: opencodeZen },
  'ollama-cloud': { name: 'Ollama Cloud', url: 'https://api.ollama.com/v1/chat/completions', models: ollamaCloud },
  'kilo-gateway': { name: 'Kilo Gateway', url: 'https://api.kilo.ai/v1/chat/completions', models: kiloGateway, noKeyRequired: true },
  'agnes-ai': { name: 'Agnes AI', url: 'https://api.agnes-ai.com/v1/chat/completions', models: agnesAi },
  'routeway': { name: 'Routeway', url: 'https://api.routeway.ai/v1/chat/completions', models: routeway },
  'bazaarlink': { name: 'BazaarLink', url: 'https://api.bazaarlink.ai/v1/chat/completions', models: bazaarlink },
  'ainative-studio': { name: 'AI Native Studio', url: 'https://api.ainative.studio/v1/chat/completions', models: ainativeStudio },
  'aihorde': { name: 'AI Horde', url: 'https://aihorde.net/api/v2/chat/completions', models: aihorde, noKeyRequired: true },
};

// Flat MODELS array with providerKey as 4th element (tier/swe from swe-bench.json)
const MODELS = [];
for (const [sourceKey, sourceData] of Object.entries(sources)) {
  if (!sourceData || !sourceData.models) continue;
  for (const entry of sourceData.models) {
    const [modelId, label, ctx] = entry;
    MODELS.push([modelId, label, '', '', ctx, sourceKey]);
  }
}

// Environment variable names per provider
const ENV_VAR_NAMES = {
  nvidia: 'NVIDIA_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  huggingface: 'HUGGINGFACE_API_KEY',
  codestral: 'CODESTRAL_API_KEY',
  googleai: 'GOOGLE_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
  cloudflare: 'CLOUDFLARE_API_TOKEN',
  zai: 'ZAI_API_KEY',
  ovhcloud: 'OVH_AI_ENDPOINTS_ACCESS_TOKEN',
  github: 'GITHUB_TOKEN',
  cohere: 'COHERE_API_KEY',
  reka: 'REKA_API_KEY',
  'ollama-cloud': 'OLLAMA_API_KEY',
  'agnes-ai': 'AGNES_API_KEY',
  'routeway': 'ROUTEWAY_API_KEY',
  'bazaarlink': 'BAZAARLINK_API_KEY',
  'ainative-studio': 'AINATIVE_API_KEY',
  'aihorde': 'AIHORDE_API_KEY',
};

// Tier order for sorting (highest first)
const TIER_ORDER = ['S+', 'S', 'A+', 'A', 'A-', 'B+', 'B', 'C'];

// Helper: Get models by tier
function getModelsByTier(tier) {
  return MODELS.filter(m => m[2] === tier);
}

// Helper: Get models by provider (synced first, static as fallback)
function getModelsByProvider(providerKey) {
  const staticModels = MODELS.filter(m => m[5] === providerKey);
  try {
    const { getSyncedModels } = require('./sync');
    const synced = getSyncedModels(providerKey);
    if (synced.length > 0) {
      const syncedIds = new Set(synced.map(m => m[0]));
      const merged = [];
      for (const sm of synced) {
        merged.push([sm[0], sm[1], sm[2], sm[3], sm[4], providerKey]);
      }
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
    return false;
  }
}

// Helper: Get all providers that have API endpoints
function getApiProviders() {
  return Object.entries(sources)
    .filter(([key, data]) => data.url && !data.cliOnly && !isProviderShutdown(key))
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

// Helper: Get model limits
function getModelLimits(modelId) {
  const model = MODELS.find(m => m[0] === modelId);
  if (model) {
    const context = parseCtxWindow(model[4]);
    const provider = model[5];
    return { context, output: getProviderMaxOutput(provider) };
  }
  try {
    const { getSyncedModels } = require('./sync');
    for (const [providerKey] of Object.entries(sources)) {
      const synced = getSyncedModels(providerKey);
      const found = synced.find(m => m[0] === modelId);
      if (found) {
        return { context: parseCtxWindow(found[4]), output: getProviderMaxOutput(providerKey) };
      }
    }
  } catch {}
  return { context: 128000, output: 8192 };
}

function getProviderMaxOutput(provider) {
  const OUTPUT_LIMITS = {
    openrouter: 32000, groq: 8192, nvidia: 8192, cerebras: 8192,
    googleai: 8192, zai: 8192, codestral: 8192,
    cloudflare: 4096, siliconflow: 4096, huggingface: 4096, ovhcloud: 4096,
    github: 4096, cohere: 4096, reka: 4096, pollinations: 4096, llm7: 4096,
  };
  return OUTPUT_LIMITS[provider] !== undefined ? OUTPUT_LIMITS[provider] : 8192;
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
