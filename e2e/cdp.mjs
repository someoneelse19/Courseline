// Chrome DevTools Protocol over --remote-debugging-pipe (needed for Extensions.loadUnpacked), Node 22, no deps.
import { spawn } from 'node:child_process';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function launch(chromePath, args) {
  // detached: Chrome starts helper processes, and killing only the first would leave them holding the profile.
  const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: true });
  const toChrome = child.stdio[3];
  const fromChrome = child.stdio[4];
  let id = 0;
  let buf = '';
  const pending = new Map();
  const listeners = [];
  fromChrome.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!raw) continue;
      const msg = JSON.parse(raw);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(`${msg.error.message} ${msg.error.data ?? ''}`)) : res(msg.result);
      } else if (msg.method) listeners.forEach((l) => l(msg));
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      toChrome.write(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  return { send, on: (fn) => listeners.push(fn), kill: () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, child };
}

/** A tab or worker you can evaluate JavaScript in. */
export async function attach(browser, targetId) {
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => browser.send(method, params, sessionId);
  const logs = [];
  browser.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled') logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    if (m.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    if (m.method === 'Log.entryAdded') logs.push(`${m.params.entry.level} [${m.params.entry.source}]: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  });
  await call('Runtime.enable').catch(() => {});
  await call('Log.enable').catch(() => {});
  return {
    sessionId,
    logs,
    call,
    // userGesture: true gives the page a real "user activation", as a click would.
    eval: async (expression, { userGesture = false } = {}) => {
      const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    screenshot: async (file) => {
      const { data } = await call('Page.captureScreenshot', { format: 'png' });
      (await import('node:fs')).writeFileSync(file, Buffer.from(data, 'base64'));
    },
  };
}
