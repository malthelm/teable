/* eslint-disable teable/naming-convention -- External protocol and source field names. */
import { readFile } from 'node:fs/promises';

export interface ICodexItem {
  type: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  [key: string]: unknown;
}
interface ICredential {
  apiKey: string;
  headers: Record<string, string>;
  expiresAt: number;
}
export async function codexCredential(): Promise<ICredential> {
  const path = process.env.TRUE_NATURE_CODEX_TOKEN_FILE;
  if (!path) throw new Error('Codex connection is not configured.');
  const c = JSON.parse(await readFile(path, 'utf8')) as ICredential;
  if (!c.apiKey || !c.expiresAt || c.expiresAt * 1000 <= Date.now() + 30000)
    throw new Error('Codex connection needs to be refreshed.');
  return c;
}

/** Incremental SSE framing, including UTF-8 split across network chunks. */
export async function* readSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2000000) throw new Error('Provider response exceeded limit.');
      let boundary: number;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const frame = buffer.slice(0, boundary);
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)![0];
        buffer = buffer.slice(boundary + separator.length);
        const data = frame
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (data && data !== '[DONE]') yield JSON.parse(data);
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
export async function codexTurn(
  input: unknown[],
  tools: unknown[],
  instructions: string,
  signal: AbortSignal,
  onText: (delta: string) => void
) {
  const c = await codexCredential();
  // Fixed provider origin; no client-controlled URL or headers.
  // eslint-disable-next-line teable/no-bare-fetch
  const response = await fetch('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.apiKey}`,
      ...c.headers,
    },
    body: JSON.stringify({
      model: process.env.TRUE_NATURE_CODEX_MODEL || 'gpt-5.6-luna',
      instructions,
      input,
      tools,
      store: false,
      stream: true,
      parallel_tool_calls: false,
      reasoning: { effort: 'low' },
    }),
  });
  if (!response.ok || !response.body)
    throw new Error(
      response.status === 429
        ? 'Codex is at its usage limit. Please try again later.'
        : 'Codex could not answer. Please try again.'
    );
  for await (const event of readSse(response.body)) {
    if (event.type === 'response.output_text.delta') onText(event.delta);
    if (event.type === 'response.completed') return event.response.output as ICodexItem[];
    if (['response.failed', 'response.incomplete', 'error'].includes(event.type))
      throw new Error('Codex could not complete this answer. Please retry.');
  }
  throw new Error('The connection ended before the answer was complete. Please retry.');
}
