import { API_ONLY } from '../edition';

// Talks to the Courseline browser extension (extension/bridge.js) through window messages. The extension is the only
// source of data when there is no Canvas token. Everything here degrades to "no extension" without throwing.

export interface CapturedRecord {
  kind: string; // e.g. 'assignmentGroups', 'courseSubmissions', 'dashboardCards'; 'other' = saved, no reader yet
  /** For kind 'other': the shape of the address, e.g. "GET /courses/:id/announcements". */
  route?: string;
  courseId: number | null;
  host: string;
  url: string;
  capturedAt: number; // ms since epoch
  body: unknown;
  /** A known route that came back in an unexpected format (kept raw as kind 'other'): the kind it failed. Never read. */
  rejectedAs?: string;
  /** GraphQL reads: the variables the page sent (which folder, which course...). */
  variables?: Record<string, unknown>;
}

export interface KindHealth {
  ok: number;
  badShape: number;
  lastOkAt: number | null;
  lastBadAt: number | null;
}

export interface Snapshot {
  records: CapturedRecord[];
  health: Record<string, KindHealth>;
  /** The courses the app last told the extension to work with (null = none chosen, use the Canvas dashboard). */
  appPinned: number[] | null;
  /** The Canvas address saved in the extension (host only, for example school.instructure.com), or null. */
  canvasHost: string | null;
  /** Pages the extension has opened for a pull: address -> when (ms). Used to skip them next time. */
  visited?: Record<string, number>;
  takenAt: number;
}

// Real browsers set `source` to this window and `origin` to this page's origin for a message the page posted to
// itself. (The simulated browser used in tests leaves both empty, so empty is accepted too; another window or
// another origin never is.)
const fromThisPage = (event: MessageEvent) =>
  (event.source === null || event.source === window) && (event.origin === '' || event.origin === window.location.origin);

const APP = 'courseline-app';
const EXT = 'courseline-extension';

/** True when the extension's bridge has announced itself on this page (it sets a data attribute at load). Never in the API-token edition. */
export function extensionInstalled(): boolean {
  return !API_ONLY && typeof document !== 'undefined' && !!document.documentElement.dataset.courselineExtension;
}

function ask<T>(type: string, timeoutMs: number, payload: object = {}): Promise<T | null> {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const finish = (value: T | null) => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      const m = event.data as { source?: string; id?: string } | null;
      if (!fromThisPage(event) || m?.source !== EXT || m.id !== id) return;
      finish(m as unknown as T);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: APP, id, type, ...payload }, window.location.origin);
  });
}

let pendingSnapshot: Promise<Snapshot | null> | null = null;

/**
 * Everything the extension has captured, or null if it is not installed or did not answer. Callers that ask while
 * a request is already out share it, so the whole store is not copied once per component.
 */
export function loadSnapshot(): Promise<Snapshot | null> {
  if (!extensionInstalled()) return Promise.resolve(null);
  pendingSnapshot ??= fetchSnapshot().finally(() => {
    pendingSnapshot = null;
  });
  return pendingSnapshot;
}

async function fetchSnapshot(): Promise<Snapshot | null> {
  const reply = await ask<Snapshot>('snapshot', 4000);
  if (!reply || !Array.isArray(reply.records)) return null;
  // An older extension build does not send appPinned.
  return {
    ...reply,
    appPinned: Array.isArray(reply.appPinned) ? reply.appPinned : null,
    canvasHost: typeof reply.canvasHost === 'string' ? reply.canvasHost : null,
    visited: reply.visited && typeof reply.visited === 'object' ? reply.visited : {},
  };
}

export interface PullStep {
  url: string;
  label: string;
}

export interface PullItem {
  /** The kind of data, or the address shape for data Courseline has no screen for yet. */
  label: string;
  count: number;
  /** A few names from what came back, for the preview. */
  sample: string[];
}

export interface PullOutcome {
  captured: number;
  items?: PullItem[];
  loaded?: boolean;
  error?: string;
}

export type PullEvent =
  | { type: 'pullProgress'; runId: string; index: number; total: number; step: PullStep; state: 'visiting' | 'done'; outcome?: PullOutcome }
  | { type: 'pullDone'; runId: string; cancelled: boolean; results: Array<{ step: PullStep } & PullOutcome>; error?: string };

/**
 * Asks the extension to open these pages one at a time in background tabs and save what they load. Progress comes
 * back through onPullEvent. Resolves with the run id, or an error (another run is going, or nothing to open).
 */
export async function startPull(steps: PullStep[], continueFrom?: string): Promise<{ ok: true; runId: string; total: number } | { ok: false; error: string }> {
  const reply = await ask<{ ok?: boolean; runId?: string; total?: number; busy?: boolean; error?: string }>('pull', 4000, { steps, continueFrom });
  if (!reply) return { ok: false, error: 'The extension did not answer. Reload this page and try again.' };
  if (reply.ok && reply.runId) return { ok: true, runId: reply.runId, total: reply.total ?? steps.length };
  return { ok: false, error: reply.busy ? 'A sync is already running.' : (reply.error ?? 'The extension could not start that.') };
}

/** An attached file as it travels to the extension: plain data only (messages cannot carry a File). */
export interface FileForExtension {
  name: string;
  type: string;
  data: string; // base64
}

export type SendRequest =
  | { kind: 'reply'; conversationId: number; body: string; files?: FileForExtension[] }
  | { kind: 'new'; recipients: number[]; subject: string; body: string; contextCode?: string; files?: FileForExtension[] };

/** Files read into base64, for sendMessage. */
export async function filesForExtension(files: readonly File[]): Promise<FileForExtension[]> {
  const out: FileForExtension[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out.push({ name: f.name, type: f.type || 'application/octet-stream', data: btoa(binary) });
  }
  return out;
}

/**
 * Sends a message through the extension (the student's own Canvas session, from a Canvas tab it opens in the
 * background). Must be called from a click: the extension refuses otherwise. Resolves with Canvas's answer (the
 * conversation, or for a new message the conversations it created) or an error message.
 */
export async function sendMessage(request: SendRequest): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  // Uploading attachments from the Canvas tab can take a while: a minute plus a little per file.
  const reply = await ask<{ ok?: boolean; result?: unknown; error?: string }>('sendMessage', 60000 + (request.files?.length ?? 0) * 30000, { request });
  if (!reply) return { ok: false, error: 'The extension did not answer. Reload this page and try again.' };
  return reply.ok ? { ok: true, result: reply.result } : { ok: false, error: reply.error ?? 'Canvas did not take the message.' };
}

/**
 * Asks the extension to read the inbox, the sent folder and every thread from Canvas (a background Canvas tab), when
 * the student opens Messages. Needs a click (opening Messages is one): `needsClick` when there was none.
 */
export async function refreshMail(): Promise<{ ok: true; skipped?: boolean } | { ok: false; error: string; needsClick?: boolean }> {
  const reply = await ask<{ ok?: boolean; skipped?: boolean; error?: string; needsClick?: boolean }>('refreshMail', 90000);
  if (!reply) return { ok: false, error: 'The extension did not answer. Reload this page and try again.' };
  return reply.ok ? { ok: true, skipped: reply.skipped } : { ok: false, error: reply.error ?? 'The messages could not be loaded.', needsClick: reply.needsClick };
}

/** The pass is over: the extension forgets the last run, so nothing can continue it. */
export async function endChain(): Promise<void> {
  await ask('endChain', 1500);
}

/** Stops after the page that is loading. */
export async function cancelPull(): Promise<void> {
  await ask('cancelPull', 1500);
}

/** Live progress of a pull. Returns the unsubscribe function. */
export function onPullEvent(callback: (event: PullEvent) => void): () => void {
  const handler = (event: MessageEvent) => {
    const m = event.data as ({ source?: string } & Partial<PullEvent>) | null;
    if (!fromThisPage(event) || m?.source !== EXT) return;
    if (m.type === 'pullProgress' || m.type === 'pullDone') callback(m as PullEvent);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

export type AddressResult = { ok: true; host: string | null } | { ok: false; error: string };

/**
 * Saves the Canvas address in the extension (the same rules as its popup: https only, host kept, switching address
 * clears data captured from the old one). Empty clears it. Null if the extension did not answer.
 */
export async function setCanvasAddress(input: string): Promise<AddressResult | null> {
  const reply = await ask<{ ok?: boolean; host?: string | null; error?: string }>('setCanvasHost', 4000, { input });
  if (!reply) return null;
  return reply.ok ? { ok: true, host: reply.host ?? null } : { ok: false, error: reply.error ?? 'The extension could not save that address.' };
}

/** Tells the extension which courses to work with: the ones chosen in the app, or null to go back to the Canvas dashboard. */
export async function setPinnedCourses(ids: number[] | null): Promise<boolean> {
  return !!(await ask('setPinned', 1500, { ids }));
}

/** The popup's "Sync in Courseline" button, pressed while this page is open: show the plan (no reload). */
export function onOpenPlanRequest(callback: () => void): () => void {
  const handler = (event: MessageEvent) => {
    const m = event.data as { source?: string; type?: string } | null;
    if (fromThisPage(event) && m?.source === EXT && m.type === 'openPlan') callback();
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/** Calls back (debounced by the extension) whenever it saves something new. Returns the unsubscribe function. */
export function onExtensionChange(callback: () => void): () => void {
  const handler = (event: MessageEvent) => {
    const m = event.data as { source?: string; type?: string } | null;
    if (fromThisPage(event) && m?.source === EXT && m.type === 'changed') callback();
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
