/**
 * Model Catalog
 *
 * Models primarily come from litellm sync (sync_models table via sync.js).
 * This file only defines provider configurations and models for providers
 * NOT covered by litellm's catalog. See PROVIDER_MAP in sync.js.
 */

// ── Models for providers NOT in litellm ──

// Google AI Studio (Gemini) — litellm maps as 'gemini', not 'googleai'
const googleai = [
  ['gemini-2.5-flash', 'Gemini 2.5 Flash', '1M'],
  ['gemini-2.0-flash', 'Gemini 2.0 Flash', '1M'],
  ['gemma-4-31b-it', 'Gemma 4 31B', '256k'],
  ['gemma-3-27b-it', 'Gemma 3 27B', '128k'],
  ['gemma-3-12b-it', 'Gemma 3 12B', '128k'],
];

// Anthropic / Claude
const anthropicModels = [
  ['claude-sonnet-4-8', 'Claude Sonnet 4.8', '200k'],
  ['claude-opus-4-8', 'Claude Opus 4.8', '200k'],
  ['claude-haiku-4-5', 'Claude Haiku 4.5', '200k'],
];

// Pollinations (not in litellm)
const pollinationsModels = [
  ['openai', 'GPT-OSS 20B (via Pollinations)', '128k'],
];

// LLM7 (not in litellm)
const llm7Models = [
  ['codestral-latest', 'Codestral Latest', '128k'],
  ['deepseek-v4-flash', 'DeepSeek V4 Flash', '128k'],
  ['gemini-2.5-flash', 'Gemini 2.5 Flash', '128k'],
  ['gpt-5.4', 'GPT 5.4', '128k'],
  ['kimi-k2.6', 'Kimi K2.6', '128k'],
];

// OpenCode Zen (not in litellm)
const opencodeZen = [
  ['big-pickle', 'Big Pickle', '200k'],
  ['mimo-v2-pro-free', 'MiMo V2 Pro Free', '1M'],
  ['mimo-v2-flash-free', 'MiMo V2 Flash Free', '262k'],
  ['minimax-m2.5-free', 'MiniMax M2.5 Free', '200k'],
  ['nemotron-3-super-free', 'Nemotron 3 Super Free', '1M'],
];

// Ollama Cloud (not in litellm)
const ollamaCloud = [
  ['qwen3-coder:480b', 'Qwen3-Coder 480B', '262k'],
  ['gpt-oss:120b', 'GPT-OSS 120B', '131k'],
  ['gemma4:31b', 'Gemma 4 31B', '131k'],
];

// GitHub Models (not in litellm)
const githubModels = [
  ['gpt-4o', 'GPT-4o', '128k'],
  ['gpt-4o-mini', 'GPT-4o Mini', '128k'],
];

// Cohere (not in litellm)
const cohereModels = [
  ['command-a', 'Command A', '256k'],
  ['command-r-plus', 'Command R+', '128k'],
];

// Reka (not in litellm)
const rekaModels = [
  ['reka-core-20250219', 'Reka Core', '128k'],
  ['reka-flash-20250219', 'Reka Flash', '128k'],
];

// ── New providers from awesome-freellm-apis ──
// ModelScope (55 free models, registration required)
const modelscopeModels = [
  ['qwen/qwen3.5-35b-a3b', 'Qwen3.5 35B-A3B', '131k'],
  ['qwen/qwen3.5-27b', 'Qwen3.5 27B', '131k'],
  ['qwen/qwen-image', 'Qwen-Image', '131k'],
];

// DeepSeek (2 free models)
const deepseekModels = [
  ['deepseek-chat', 'DeepSeek Chat (V3.2)', '128k'],
  ['deepseek-reasoner', 'DeepSeek Reasoner (R1)', '128k'],
];

// AI21 Labs (2 free models)
const ai21Models = [
  ['jamba-large-1-7', 'Jamba Large 1.7', '256k'],
  ['jamba-mini-2', 'Jamba Mini 2', '256k'],
];

// Aion Labs (5 free models)
const aionModels = [
  ['aion-2-5', 'Aion 2.5', '128k'],
  ['aion-2-0', 'Aion 2.0', '128k'],
  ['aion-rp-1-0-8b', 'Aion-RP 1.0 8B', '32k'],
];

// Glhf.chat (2 free models, unlimited)
const glhfModels = [
  ['meta-llama/Meta-Llama-3.1-70B-Instruct', 'Llama 3.1 70B', '131k'],
  ['mistralai/Mixtral-8x7B-Instruct-v0.1', 'Mixtral 8x7B', '32k'],
];

// Nscale (2 free models)
const nscaleModels = [
  ['llama-3-3-70b-instruct', 'Llama 3.3 70B', '128k'],
  ['deepseek-r1-distill-llama-70b', 'DeepSeek R1 Distill Llama 70B', '128k'],
];

// Nebius (1 free model)
const nebiusModels = [
  ['qwen3-235b-a22b', 'Qwen3 235B-A22B', '128k'],
];

// xAI / Grok (2 free models)
const xaiModels = [
  ['grok-2', 'Grok-2', '131k'],
  ['grok-2-mini', 'Grok-2 Mini', '131k'],
];

// ── Empty arrays for providers served by litellm sync ──
const nvidiaNim = []; const groq = []; const cerebras = [];
const openrouter = []; const huggingface = []; const codestral = [];
const zai = []; const siliconflow = []; const cloudflare = [];
const ovhcloud = []; const sambanova = []; const deepinfra = [];
const replicate = []; const hyperbolic = []; const scaleway = [];
const perplexity = []; const fireworks = []; const together = [];
const qwen = []; const chutes = []; const iflow = [];
const reka = []; const kiloGateway = []; const agnesAi = [];
const routeway = []; const bazaarlink = []; const ainativeStudio = [];
const aihorde = [];

// ── Provider configurations ──
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
  'kilo-gateway': { name: 'Kilo Gateway', url: null, models: kiloGateway, noKeyRequired: true },
  'agnes-ai': { name: 'Agnes AI', url: null, models: agnesAi },
  'routeway': { name: 'Routeway', url: null, models: routeway },
  'bazaarlink': { name: 'BazaarLink', url: null, models: bazaarlink },
  'ainative-studio': { name: 'AI Native Studio', url: null, models: ainativeStudio },
  'aihorde': { name: 'AI Horde', url: null, models: aihorde, noKeyRequired: true },
  'anthropic': { name: 'Anthropic', url: 'https://api.anthropic.com/v1/messages', models: anthropicModels, anthropicFormat: true },
  'modelscope': { name: 'ModelScope', url: 'https://api-inference.modelscope.cn/v1/chat/completions', models: modelscopeModels },
  'deepseek': { name: 'DeepSeek', url: 'https://api.deepseek.com/v1/chat/completions', models: deepseekModels },
  'ai21': { name: 'AI21 Labs', url: 'https://api.ai21.com/studio/v1/chat/completions', models: ai21Models },
  'aion-labs': { name: 'Aion Labs', url: 'https://api.aionlabs.ai/v1/chat/completions', models: aionModels },
  'glhf': { name: 'Glhf.chat', url: 'https://glhf.chat/api/openai/v1/chat/completions', models: glhfModels },
  'nscale': { name: 'Nscale', url: 'https://inference.api.nscale.com/v1/chat/completions', models: nscaleModels },
  'nebius': { name: 'Nebius', url: 'https://api.studio.nebius.com/v1/chat/completions', models: nebiusModels },
  'xai': { name: 'xAI (Grok)', url: 'https://api.x.ai/v1/chat/completions', models: xaiModels },
};

// ── Flat MODELS array (for backward compatibility) ──
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
  nvidia: 'NVIDIA_API_KEY', groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY', sambanova: 'SAMBANOVA_API_KEY',
  openrouter: 'OPENROUTER_API_KEY', huggingface: ['HUGGINGFACE_API_KEY', 'HF_TOKEN'],
  replicate: 'REPLICATE_API_TOKEN', deepinfra: ['DEEPINFRA_API_KEY', 'DEEPINFRA_TOKEN'],
  fireworks: 'FIREWORKS_API_KEY', codestral: 'CODESTRAL_API_KEY',
  hyperbolic: 'HYPERBOLIC_API_KEY', scaleway: 'SCALEWAY_API_KEY',
  googleai: 'GOOGLE_API_KEY', siliconflow: 'SILICONFLOW_API_KEY',
  together: 'TOGETHER_API_KEY', cloudflare: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY'],
  perplexity: ['PERPLEXITY_API_KEY', 'PPLX_API_KEY'], qwen: 'DASHSCOPE_API_KEY',
  zai: 'ZAI_API_KEY', iflow: 'IFLOW_API_KEY', chutes: 'CHUTES_API_KEY',
  ovhcloud: 'OVH_AI_ENDPOINTS_ACCESS_TOKEN', github: 'GITHUB_TOKEN',
  cohere: 'COHERE_API_KEY', reka: 'REKA_API_KEY',
  pollinations: null, llm7: null, 'opencode-zen': null,
  modelscope: 'MODELSCOPE_API_KEY', deepseek: 'DEEPSEEK_API_KEY',
  ai21: 'AI21_API_KEY', 'aion-labs': 'AION_API_KEY',
  glhf: 'GLHF_API_KEY', nscale: 'NSCALE_API_KEY', nebius: 'NEBIUS_API_KEY',
  xai: 'XAI_API_KEY',
};

// Context windows per provider
const PROVIDER_CONTEXT_LIMITS = {
  nvidia: 131072, groq: 131072, cerebras: 131072, googleai: 1048576,
  openrouter: 262144, codestral: 262144, github: 131072, cohere: 262144,
  cloudflare: 131072, pollinations: 4096, llm7: 4096,
  modelscope: 131072, deepseek: 131072, ai21: 262144,
  'aion-labs': 131072, glhf: 131072, nscale: 131072, nebius: 131072,
  xai: 131072,
};

// ── Helper functions ──

function getModelsByProvider(providerKey) {
  const staticModels = MODELS.filter(m => m[5] === providerKey);
  try {
    const { getSyncedModels } = require('./sync');
    const synced = getSyncedModels(providerKey);
    if (synced.length > 0) {
      const syncedIds = new Set(synced.map(m => m[0]));
      const merged = [];
      for (const sm of synced) merged.push([sm[0], sm[1], sm[2], sm[3], sm[4], providerKey]);
      for (const m of staticModels) {
        if (!syncedIds.has(m[0])) merged.push(m);
      }
      return merged;
    }
  } catch {}
  return staticModels;
}

function getModelsByTier(tier) {
  return MODELS.filter(m => m[2] === tier);
}

function getProviderForModel(modelId) {
  const found = MODELS.find(m => m[0] === modelId);
  return found ? found[5] : null;
}

function isProviderShutdown(providerKey) {
  return false;
}

function getModelLimits(modelId) {
  const providerKey = getProviderForModel(modelId);
  const context = PROVIDER_CONTEXT_LIMITS[providerKey] || 128000;
  // Check synced models for more precise context
  try {
    const { getSyncedModels } = require('./sync');
    for (const p of Object.keys(require('./sync').PROVIDER_MAP || {})) {
      const models = getSyncedModels(p);
      const found = models.find(m => m[0] === modelId || m[0].endsWith('/' + modelId));
      if (found) {
        const ctxStr = found[4] || '';
        const ctxNum = parseInt(ctxStr) || context;
        return { context: ctxNum, output: Math.min(ctxNum, 16384) };
      }
    }
  } catch {}
  return { context, output: Math.min(context, 16384) };
}

module.exports = { sources, MODELS, ENV_VAR_NAMES, getModelsByProvider, getModelsByTier, getProviderForModel, isProviderShutdown, getModelLimits, PROVIDER_CONTEXT_LIMITS };
