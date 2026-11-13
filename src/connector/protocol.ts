import { CanvasApiError } from '../api/client';
import { ToolInputError, type Tool, type ToolContext } from './tools';

// The Model Context Protocol, the small part a tools-only server needs: JSON-RPC 2.0 messages, one per line, over
// stdin/stdout (https://modelcontextprotocol.io/specification). The Claude desktop app sends `initialize`, then
// `tools/list` and `tools/call`; this answers them. Written by hand to keep the connector free of dependencies.

export const SERVER_INFO = { name: 'courseline-canvas', version: '0.1.0' };

/** Protocol versions this server speaks. It answers with the client's version when it knows it, else the newest. */
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = [
  "These tools read the student's own Canvas (their courses, assignments, grades, pages, files and quiz results). They cannot change anything in Canvas.",
  'Start with list_courses or get_upcoming. A course can be named by its id or part of its name.',
  'Links written file:123 (and numbers after /files/ in Canvas links) are file ids to open with read_file.',
  'When helping the student learn, ground explanations in their course material and say where it comes from (unit, page, file).',
].join(' ');

interface Request {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type Response = { jsonrpc: '2.0'; id: string | number | null; result: unknown } | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } };

const ok = (id: Request['id'], result: unknown): Response => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: Request['id'], code: number, message: string): Response => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** What a failed tool call tells Claude: the reason in words, and what to do about a bad token. */
function failureText(err: unknown): string {
  if (err instanceof ToolInputError) return err.message;
  if (err instanceof CanvasApiError) {
    if (err.kind === 'unauthorized') return 'Canvas refused the access token (it may have expired or been deleted). The student needs to make a new token in Canvas (Account → Settings → New access token) and paste it into the Courseline connector settings in the Claude app.';
    if (err.kind === 'forbidden') return `Canvas does not let the student see this (${err.message}).`;
    if (err.kind === 'not_found') return `Canvas has no such item, or hides it from students (${err.message}).`;
    return `Canvas error: ${err.message}`;
  }
  return `Something went wrong: ${err instanceof Error ? err.message : String(err)}`;
}

export function createHandler(tools: Tool[], ctx: ToolContext) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  /** Answers one message; null for notifications (no id), which get no answer. */
  return async function handle(message: unknown): Promise<Response | null> {
    if (!message || typeof message !== 'object' || (message as Request).jsonrpc !== '2.0' || typeof (message as Request).method !== 'string') {
      return fail(null, -32600, 'Invalid request');
    }
    const req = message as Request;
    const isNotification = req.id === undefined;
    switch (req.method) {
      case 'initialize': {
        const asked = String(req.params?.protocolVersion ?? '');
        return ok(req.id, {
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return ok(req.id, {});
      case 'tools/list':
        return ok(req.id, {
          tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } })),
        });
      case 'tools/call': {
        const name = String(req.params?.name ?? '');
        const tool = byName.get(name);
        if (!tool) return fail(req.id, -32602, `Unknown tool: ${name}`);
        const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
        try {
          const out = await tool.run(args, ctx);
          const content: unknown[] = [];
          if (out.image) content.push({ type: 'image', data: out.image.data, mimeType: out.image.mimeType });
          if (out.text) content.push({ type: 'text', text: out.text });
          return ok(req.id, { content, isError: false });
        } catch (err) {
          // A tool failure is a result Claude reads (and can recover from), not a protocol error.
          return ok(req.id, { content: [{ type: 'text', text: failureText(err) }], isError: true });
        }
      }
      default:
        if (isNotification) return null; // notifications/initialized, notifications/cancelled, …
        return fail(req.id, -32601, `Method not found: ${req.method}`);
    }
  };
}
