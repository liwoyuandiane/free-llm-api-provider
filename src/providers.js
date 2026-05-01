/**
 * Provider Registry
 * 
 * Replicated from free-coding-models to work standalone.
 * Contains endpoints, env vars, and default models for all 25+ providers.
 */

const PROVIDERS = {
    // =========================================================================
    // Tier S+ (70%+ SWE-bench)
    // =========================================================================
    
    nvidia: {
        name: 'NVIDIA NIM',
        envKey: 'NVIDIA_API_KEY',
        endpoint: 'https://integrate.api.nvidia.com/v1',
        models: [
            'nvidia/llama-3.1-nemotron-70b-instruct',
            'nvidia/llama-3.3-70b-instruct',
            'nvidia/llama-3.1-8b-instruct',
            'nvidia/Phi-3.5-mini-instruct',
            'nvidia/Phi-4-mini-instruct',
            'nvidia/deepseek-ai/deepseek-v3'
        ]
    },
    
    cerebras: {
        name: 'Cerebras',
        envKey: 'CEREBRAS_API_KEY',
        endpoint: 'https://api.cerebras.ai/v1',
        models: [
            'llama-3.1-70b',
            'llama-3.3-70b',
            'Qwen/Qwen2.5-72B-Instruct'
        ]
    },
    
    sambanova: {
        name: 'SambaNova',
        envKey: 'SAMBANOVA_API_KEY',
        endpoint: 'https://api.sambanova.ai/v1',
        models: [
            'Meta-Llama-3.1-70B-Instruct',
            'Meta-Llama-3.1-8B-Instruct',
            'Qwen/Qwen2.5-72B-Instruct'
        ]
    },
    
    hyperbolic: {
        name: 'Hyperbolic',
        envKey: 'HYPERBOLIC_API_KEY',
        endpoint: 'https://api.hyperbolic.ai/v1',
        models: [
            'meta-llama/Llama-3.1-70B-Instruct',
            'Qwen/Qwen2.5-72B-Instruct',
            'meta-llama/Meta-Llama-3.1-8B-Instruct'
        ]
    },
    
    zai: {
        name: 'ZAI',
        envKey: 'ZAI_API_KEY',
        endpoint: 'https://api.zai.dev/v1',
        models: [
            'zai/coding-standard',
            'zai/coding-pro'
        ]
    },
    
    // =========================================================================
    // Tier S (60-70% SWE-bench)
    // =========================================================================
    
    groq: {
        name: 'Groq',
        envKey: 'GROQ_API_KEY',
        endpoint: 'https://api.groq.com/openai/v1',
        models: [
            'llama-3.1-70b-versatile',
            'llama-3.1-8b-instant',
            'mixtral-8x7b-32768',
            'gemma-7b-it'
        ]
    },
    
    cloudflare: {
        name: 'Cloudflare Workers AI',
        envKey: 'CLOUDFLARE_API_TOKEN',
        envVars: ['CLOUDFLARE_ACCOUNT_ID'],
        endpoint: 'https://api.cloudflare.ai/v1',
        models: [
            '@cf/meta/llama-3.1-70b-instruct',
            '@cf/meta/llama-3.1-8b-instruct',
            '@cf/qwen/qwen2.5-72b-instruct'
        ]
    },
    
    huggingface: {
        name: 'HuggingFace',
        envKey: 'HUGGINGFACE_API_KEY',
        endpoint: 'https://api-inference.huggingface.co/v1',
        models: [
            'meta-llama/Llama-3.1-70B-Instruct',
            'meta-llama/Llama-3.1-8B-Instruct'
        ]
    },
    
    // =========================================================================
    // Tier A+ / A (40-60% SWE-bench)
    // =========================================================================
    
    openrouter: {
        name: 'OpenRouter',
        envKey: 'OPENROUTER_API_KEY',
        endpoint: 'https://openrouter.ai/api/v1',
        models: [
            'google/gemma-2-9b-it',
            'google/gemma-2-27b-it',
            'anthropic/claude-3.5-sonnet',
            'meta-llama/llama-3.1-8b-instruct',
            'mistralai/mistral-large',
            'deepseek/deepseek-chat'
        ]
    },
    
    google: {
        name: 'Google AI Studio',
        envKey: 'GOOGLE_API_KEY',
        endpoint: 'https://generativelanguage.googleapis.com/v1',
        models: [
            'gemini-1.5-flash',
            'gemini-1.5-pro',
            'gemini-2.0-flash'
        ]
    },
    
    perplexity: {
        name: 'Perplexity',
        envKey: 'PERPLEXITY_API_KEY',
        endpoint: 'https://api.perplexity.ai',
        models: [
            'llama-3.1-sonar-large-128k',
            'llama-3.1-sonar-small-128k'
        ]
    },
    
    fireworks: {
        name: 'Fireworks AI',
        envKey: 'FIREWORKS_API_KEY',
        endpoint: 'https://api.fireworks.ai/v1',
        models: [
            'fireworks-ai/firefunction-v2',
            'fireworks-ai/firellama-3.1-70b-instruct'
        ]
    },
    
    deepinfra: {
        name: 'DeepInfra',
        envKey: 'DEEPINFRA_API_KEY',
        endpoint: 'https://api.deepinfra.com/v1',
        models: [
            'meta-llama/Meta-Llama-3.1-70B-Instruct',
            'meta-llama/Meta-Llama-3.1-8B-Instruct'
        ]
    },
    
    scaleway: {
        name: 'Scaleway',
        envKey: 'SCALEWAY_API_KEY',
        endpoint: 'https://api.scaleway.com/v1',
        models: [
            'llama-3.1-70b',
            'llama-3.1-8b'
        ]
    },
    
    siliconflow: {
        name: 'SiliconFlow',
        envKey: 'SILICONFLOW_API_KEY',
        endpoint: 'https://api.siliconflow.cn/v1',
        models: [
            'Qwen/Qwen2.5-72B-Instruct',
            'THUDM/glm-4-9b-chat'
        ]
    },
    
    // =========================================================================
    // Tier B+ / B (30-40% SWE-bench)
    // =========================================================================
    
    replicate: {
        name: 'Replicate',
        envKey: 'REPLICATE_API_TOKEN',
        endpoint: 'https://api.replicate.com/v1',
        models: [
            'meta/llama-3.1-70b-instruct'
        ]
    },
    
    mistral: {
        name: 'Mistral',
        envKey: 'MISTRAL_API_KEY',
        endpoint: 'https://api.mistral.ai/v1',
        models: [
            'mistral-large-latest',
            'mistral-small-latest'
        ]
    },
    
    dashscope: {
        name: 'Alibaba DashScope',
        envKey: 'DASHSCOPE_API_KEY',
        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        models: [
            'qwen-turbo',
            'qwen-plus'
        ]
    },
    
    ovh: {
        name: 'OVHcloud AI Endpoints',
        envKey: 'OVH_AI_ENDPOINTS_ACCESS_TOKEN',
        endpoint: 'https://endpoints.ai.cloud.ovh.net',
        models: [
            'LLama3.1-70B-Instruct'
        ]
    },
    
    codestral: {
        name: 'Mistral Codestral',
        envKey: 'CODESTRAL_API_KEY',
        endpoint: 'https://codestral.mistral.ai/v1',
        models: [
            'codestral-latest'
        ]
    },
    
    chutes: {
        name: 'Chutes AI',
        envKey: 'CHUTES_API_KEY',
        endpoint: 'https://api.chutes.ai/v1',
        models: [
            'mistralai/Mistral-7B-Instruct-v0.1'
        ]
    },
    
    // =========================================================================
    // Special / CLI-only (not for proxy)
    // =========================================================================
    
    rovo: {
        name: 'Atlassian Rovo',
        cliOnly: true,
        models: ['claude-sonnet-4-20250514']
    },
    
    gemini_cli: {
        name: 'Google Gemini CLI',
        cliOnly: true,
        models: ['gemini-2.0-flash-exp']
    },
    
    opencode_zen: {
        name: 'OpenCode Zen',
        cliOnly: true,
        models: ['opencode/claude-opus-4']
    }
};

// Export for use in other modules
module.exports = { PROVIDERS };

// Also make available globally for CLI
if (typeof global !== 'undefined') {
    global.PROVIDERS = PROVIDERS;
}
