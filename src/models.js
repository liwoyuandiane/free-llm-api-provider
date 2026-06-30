/**
 * Model Catalog
 *
 * 29 free LLM providers from awesome-freellm-apis.
 * Each provider has exactly 1 best free model as baseline.
 */
const googleai = [['gemini-3-5-flash', 'Gemini 3.5 Flash', '1M']];
const pollinationsModels = [['openai', 'GPT-OSS 20B (via Pollinations)', '128k']];
const llm7Models = [['deepseek-r1-0528', 'DeepSeek R1 0528', '131k']];
const opencodeZen = [['big-pickle', 'Big Pickle', '200k']];
const ollamaCloud = [['gpt-oss:120b-cloud', 'GPT-OSS 120B Cloud', '128k']];
const kiloGateway = [['x-ai-grok-code-fast-1-free', 'Grok Code Fast 1 Free', '256k']];
const githubModels = [['Phi-4', 'Phi 4', '131k']];
const cohereModels = [['command-a-218b', 'Command A+ 218B', '128k']];
const modelscopeModels = [['qwen/Qwen3.5-35B-A3B', 'Qwen3.5 35B A3B', '131k']];
const deepseekModels = [['deepseek-chat', 'DeepSeek Chat V3.2', '128k']];
const ai21Models = [['jamba-large-1-7', 'Jamba Large 1.7', '256k']];
const aionModels = [['aion-2-5', 'Aion 2.5', '128k']];
const glhfModels = [['meta-llama/Meta-Llama-3.1-70B-Instruct', 'Llama 3.1 70B', '131k']];
const nscaleModels = [['llama-3-3-70b-instruct', 'Llama 3.3 70B', '128k']];
const nebiusModels = [['qwen3-235b-a22b', 'Qwen3 235B A22B', '128k']];
const xaiModels = [['grok-4-3', 'Grok 4.3', '1M']];
const nvidiaNim = [['z-ai/glm-5.1', 'Z AI GLM 5.1', '202k']];
const groq = [['moonshotai/kimi-k2-instruct', 'Kimi K2 Instruct', '131k']];
const cerebras = [['llama3.1-70b', 'Llama 3.1 70B', '131k']];
const cloudflare = [['@cf/mistral/mistral-7b-instruct-v0.1', 'Mistral 7B', '32k']];
const openrouter = [['openrouter/owl-alpha', 'Owl Alpha', '1M']];
const huggingface = [['meta-llama-3-1-8b-instruct', 'Meta Llama 3.1 8B', '128k']];
const ovhcloud = [['qwen3-5-397b-a17b', 'Qwen3.5 397B A17B', '131k']];
const codestral = [['open-mistral-7b', 'Mistral 7B', '32k']];
const zai = [['glm-4-7-flash', 'GLM 4.7 Flash', '200k']];
const siliconflow = [['deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', 'DeepSeek R1 Distill Qwen 7B', '131k']];
const sambanova = [['deepseek-v3-1', 'DeepSeek V3.1', '128k']];
const chutes = [['deepseek-ai/DeepSeek-R1', 'DeepSeek R1', '131k']];
const qwen = [['qwen3-max', 'Qwen3 Max', '128k']];

const sources = {
  nvidia: { name: 'NVIDIA NIM', url: 'https://integrate.api.nvidia.com/v1/chat/completions', models: nvidiaNim },
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', models: groq },
  cerebras: { name: 'Cerebras', url: 'https://api.cerebras.ai/v1/chat/completions', models: cerebras },
  googleai: { name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', models: googleai },
  cloudflare: { name: 'Cloudflare AI', url: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions', models: cloudflare },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', models: openrouter },
  huggingface: { name: 'Hugging Face', url: 'https://router.huggingface.co/v1/chat/completions', models: huggingface },
  ovhcloud: { name: 'OVHcloud AI', url: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions', models: ovhcloud },
  codestral: { name: 'Mistral AI', url: 'https://api.mistral.ai/v1/chat/completions', models: codestral },
  zai: { name: 'Z AI (Zhipu)', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', models: zai },
  siliconflow: { name: 'SiliconFlow', url: 'https://api.siliconflow.cn/v1/chat/completions', models: siliconflow },
  github: { name: 'GitHub Models', url: 'https://models.inference.ai.azure.com/chat/completions', models: githubModels },
  cohere: { name: 'Cohere', url: 'https://api.cohere.com/v2/chat/completions', models: cohereModels },
  pollinations: { name: 'Pollinations', url: 'https://text.pollinations.ai/openai/', models: pollinationsModels, noKeyRequired: true },
  llm7: { name: 'LLM7', url: 'https://api.llm7.io/v1/chat/completions', models: llm7Models, noKeyRequired: true },
  'opencode-zen': { name: 'OpenCode Zen', url: 'https://opencode.ai/zen/v1/chat/completions', models: opencodeZen },
  'ollama-cloud': { name: 'Ollama Cloud', url: 'https://api.ollama.com/v1/chat/completions', models: ollamaCloud },
  'kilo-gateway': { name: 'Kilo Code', url: 'https://api.kilo.ai/api/gateway/chat/completions', models: kiloGateway, noKeyRequired: true },
  modelscope: { name: 'ModelScope', url: 'https://api-inference.modelscope.cn/v1/chat/completions', models: modelscopeModels },
  deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/v1/chat/completions', models: deepseekModels },
  ai21: { name: 'AI21 Labs', url: 'https://api.ai21.com/studio/v1/chat/completions', models: ai21Models },
  'aion-labs': { name: 'Aion Labs', url: 'https://api.aionlabs.ai/v1/chat/completions', models: aionModels },
  glhf: { name: 'Glhf.chat', url: 'https://glhf.chat/api/openai/v1/chat/completions', models: glhfModels },
  nscale: { name: 'Nscale', url: 'https://inference.api.nscale.com/v1/chat/completions', models: nscaleModels },
  nebius: { name: 'Nebius', url: 'https://api.studio.nebius.com/v1/chat/completions', models: nebiusModels },
  xai: { name: 'xAI (Grok)', url: 'https://api.x.ai/v1/chat/completions', models: xaiModels },
  sambanova: { name: 'SambaNova', url: 'https://api.sambanova.ai/v1/chat/completions', models: sambanova },
  chutes: { name: 'Chutes.ai', url: 'https://api.chutes.ai/v1/chat/completions', models: chutes },
  qwen: { name: 'Alibaba Qwen', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', models: qwen },
};

const MODELS = [];
for (const [sourceKey, sourceData] of Object.entries(sources)) {
  if (!sourceData || !sourceData.models) continue;
  for (const entry of sourceData.models) {
    const [modelId, label, ctx] = entry;
    MODELS.push([modelId, label, '', '', ctx, sourceKey]);
  }
}

const ENV_VAR_NAMES = {
  nvidia: 'NVIDIA_API_KEY', groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY', sambanova: 'SAMBANOVA_API_KEY',
  openrouter: 'OPENROUTER_API_KEY', huggingface: ['HUGGINGFACE_API_KEY', 'HF_TOKEN'],
  codestral: 'CODESTRAL_API_KEY', googleai: 'GOOGLE_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
  cloudflare: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY'],
  zai: 'ZAI_API_KEY', ovhcloud: 'OVH_AI_ENDPOINTS_ACCESS_TOKEN',
  github: 'GITHUB_TOKEN', cohere: 'COHERE_API_KEY',
  'ollama-cloud': 'OLLAMA_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY', ai21: 'AI21_API_KEY',
  'aion-labs': 'AION_API_KEY', glhf: 'GLHF_API_KEY',
  nscale: 'NSCALE_API_KEY', nebius: 'NEBIUS_API_KEY', xai: 'XAI_API_KEY',
  chutes: 'CHUTES_API_KEY', qwen: 'DASHSCOPE_API_KEY',
  modelscope: 'MODELSCOPE_API_KEY',
  pollinations: null, llm7: null, 'opencode-zen': null, 'kilo-gateway': null,
};

const PROVIDER_CONTEXT_LIMITS = {
  nvidia: 131072, groq: 131072, cerebras: 131072, googleai: 1048576,
  openrouter: 262144, codestral: 262144, github: 131072, cohere: 262144,
  cloudflare: 131072, pollinations: 4096, llm7: 4096,
  modelscope: 131072, deepseek: 131072, ai21: 262144,
  'aion-labs': 131072, glhf: 131072, nscale: 131072, nebius: 131072,
  xai: 1048576, sambanova: 131072, chutes: 131072, qwen: 131072,
  'kilo-gateway': 262144, 'ollama-cloud': 131072,
  huggingface: 131072, ovhcloud: 131072, zai: 131072,
  siliconflow: 131072, 'opencode-zen': 131072,
};

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

function getModelsByTier(tier) { return MODELS.filter(m => m[2] === tier); }
function getProviderForModel(modelId) { const found = MODELS.find(m => m[0] === modelId); return found ? found[5] : null; }
function isProviderShutdown(providerKey) { return false; }

function getModelLimits(modelId) {
  const providerKey = getProviderForModel(modelId);
  const context = PROVIDER_CONTEXT_LIMITS[providerKey] || 128000;
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

const TIER_ORDER = ['S+', 'S', 'A+', 'A', 'A-', 'B+', 'B', 'C', 'error'];

module.exports = { sources, MODELS, ENV_VAR_NAMES, getModelsByProvider, getModelsByTier, getProviderForModel, isProviderShutdown, getModelLimits, PROVIDER_CONTEXT_LIMITS, TIER_ORDER };
