// Pure: what a message the app asks the extension to send may look like. Anything else is refused (null), so a script
// on the app page cannot use the bridge to send arbitrary requests to Canvas: only a reply in a conversation, or a new
// message to Canvas user ids, with plain-text bodies of a sane size.

export const MAX_BODY = 20000;
export const MAX_SUBJECT = 255;
export const MAX_RECIPIENTS = 50;
export const MAX_FILES = 10;
export const MAX_FILES_BYTES = 25 * 1024 * 1024; // all attachments of one message together

/** Attached files as they travel to the Canvas tab: name, type and the bytes as base64. Null if any is wrong. */
function cleanFiles(files) {
  if (files === undefined) return [];
  if (!Array.isArray(files) || files.length > MAX_FILES) return null;
  let bytes = 0;
  const out = [];
  for (const f of files) {
    if (!f || typeof f.name !== 'string' || !f.name.trim() || f.name.length > 255 || typeof f.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.data)) return null;
    bytes += Math.floor((f.data.length * 3) / 4);
    if (bytes > MAX_FILES_BYTES) return null;
    out.push({ name: f.name.trim(), type: typeof f.type === 'string' && f.type.length < 255 ? f.type : 'application/octet-stream', data: f.data });
  }
  return out;
}

const positiveId = (n) => Number.isInteger(n) && n > 0 && n < 1e15;

/** @returns {{kind:'reply', conversationId:number, body:string} | {kind:'new', recipients:number[], subject:string, body:string, contextCode?:string} | null} */
export function cleanSendRequest(r) {
  if (!r || typeof r !== 'object') return null;
  const body = typeof r.body === 'string' ? r.body.trim() : '';
  if (!body || body.length > MAX_BODY) return null;
  const files = cleanFiles(r.files);
  if (!files) return null;
  const withFiles = files.length ? { files } : {};
  if (r.kind === 'reply') {
    return positiveId(r.conversationId) ? { kind: 'reply', conversationId: r.conversationId, body, ...withFiles } : null;
  }
  if (r.kind === 'new') {
    const recipients = Array.isArray(r.recipients) ? [...new Set(r.recipients)] : [];
    if (!recipients.length || recipients.length > MAX_RECIPIENTS || !recipients.every(positiveId)) return null;
    const subject = typeof r.subject === 'string' ? r.subject.trim().slice(0, MAX_SUBJECT) : '';
    const contextCode = typeof r.contextCode === 'string' && /^course_\d{1,15}$/.test(r.contextCode) ? r.contextCode : undefined;
    return { kind: 'new', recipients, subject, body, ...(contextCode ? { contextCode } : {}), ...withFiles };
  }
  return null;
}

/** The Canvas API request for a clean send request: same-origin path and JSON body (Canvas's documented endpoints). */
export function sendRequestFor(req) {
  if (req.kind === 'reply') return { path: `/api/v1/conversations/${req.conversationId}/add_message`, payload: { body: req.body } };
  return {
    path: '/api/v1/conversations',
    payload: { recipients: req.recipients.map(String), subject: req.subject, body: req.body, group_conversation: true, ...(req.contextCode ? { context_code: req.contextCode } : {}) },
  };
}
