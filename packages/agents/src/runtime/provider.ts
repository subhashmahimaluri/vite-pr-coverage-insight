/**
 * Phase 5.1 — provider abstraction (decision D2: AI is strictly optional;
 * this package is only ever loaded via dynamic import when ai !== 'off').
 * Implementations are fetch-based — no provider SDKs, no transitive weight.
 */

export type CompletionUsage = { text: string; inputTokens: number; outputTokens: number };

export type CompleteOptions = { maxTokens: number; timeoutMs: number; signal?: AbortSignal };

export type ModelProvider = {
  name: string;
  complete(prompt: string, opts: CompleteOptions): Promise<CompletionUsage>;
};

export type ProviderEnv = Record<string, string | undefined>;

export type ProviderConfig = {
  provider?: 'anthropic' | 'bedrock' | 'vertex';
  model?: string;
  region?: string;
  project?: string;
};

const DEFAULT_MODEL = 'claude-sonnet-4-6';

type AnthropicResponse = {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

function parseAnthropicResponse(body: AnthropicResponse): CompletionUsage {
  const text = (body.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
  return {
    text,
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
  };
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  opts: CompleteOptions
): Promise<AnthropicResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
    signal: opts.signal ?? null,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}: ${detail.slice(0, 300)}`);
  }
  return (await response.json()) as AnthropicResponse;
}

export function anthropicProvider(env: ProviderEnv, config: ProviderConfig = {}): ModelProvider {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Anthropic provider selected but ANTHROPIC_API_KEY is not set');
  const model = config.model ?? env.AI_MODEL ?? DEFAULT_MODEL;
  return {
    name: 'anthropic',
    async complete(prompt, opts) {
      const body = await postJson(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: opts.maxTokens, messages: [{ role: 'user', content: prompt }] },
        opts
      );
      return parseAnthropicResponse(body);
    },
  };
}

/**
 * AWS Bedrock via API-key (bearer token) auth — set AWS_BEARER_TOKEN_BEDROCK.
 * SigV4/IAM-role auth is intentionally out of scope for the SDK-free runtime.
 */
export function bedrockProvider(env: ProviderEnv, config: ProviderConfig = {}): ModelProvider {
  const token = env.AWS_BEARER_TOKEN_BEDROCK;
  if (!token) throw new Error('Bedrock provider selected but AWS_BEARER_TOKEN_BEDROCK is not set');
  const region = config.region ?? env.AWS_REGION ?? 'us-east-1';
  const model = config.model ?? env.AI_MODEL ?? `us.anthropic.${DEFAULT_MODEL}-v1:0`;
  return {
    name: 'bedrock',
    async complete(prompt, opts) {
      const body = await postJson(
        `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/invoke`,
        { authorization: `Bearer ${token}` },
        {
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: opts.maxTokens,
          messages: [{ role: 'user', content: prompt }],
        },
        opts
      );
      return parseAnthropicResponse(body);
    },
  };
}

/**
 * Google Vertex with a caller-provided OAuth token (GOOGLE_VERTEX_TOKEN,
 * e.g. `gcloud auth print-access-token`).
 */
export function vertexProvider(env: ProviderEnv, config: ProviderConfig = {}): ModelProvider {
  const token = env.GOOGLE_VERTEX_TOKEN;
  const project = config.project ?? env.GOOGLE_VERTEX_PROJECT;
  if (!token) throw new Error('Vertex provider selected but GOOGLE_VERTEX_TOKEN is not set');
  if (!project) throw new Error('Vertex provider selected but GOOGLE_VERTEX_PROJECT is not set');
  const region = config.region ?? env.GOOGLE_VERTEX_REGION ?? 'us-east5';
  const model = config.model ?? env.AI_MODEL ?? DEFAULT_MODEL;
  return {
    name: 'vertex',
    async complete(prompt, opts) {
      const body = await postJson(
        `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/anthropic/models/${model}:rawPredict`,
        { authorization: `Bearer ${token}` },
        {
          anthropic_version: 'vertex-2023-10-16',
          max_tokens: opts.maxTokens,
          messages: [{ role: 'user', content: prompt }],
        },
        opts
      );
      return parseAnthropicResponse(body);
    },
  };
}

export function selectProvider(env: ProviderEnv, config: ProviderConfig = {}): ModelProvider {
  const name = config.provider ?? (env.AI_PROVIDER as ProviderConfig['provider']) ?? 'anthropic';
  switch (name) {
    case 'anthropic':
      return anthropicProvider(env, config);
    case 'bedrock':
      return bedrockProvider(env, config);
    case 'vertex':
      return vertexProvider(env, config);
    default:
      throw new Error(`Unknown AI provider '${name}' — expected anthropic, bedrock or vertex`);
  }
}
