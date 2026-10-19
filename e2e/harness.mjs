import { launch, attach, sleep } from './cdp.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const dir = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION = path.resolve(dir, '../extension');
export const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const APP = process.env.APP_URL ?? 'http://localhost:5173/';
export { sleep };

/** Makes the self-signed certificate for canvas.test, once. */
export function ensureCert() {
  if (fs.existsSync(`${dir}/key.pem`) && fs.existsSync(`${dir}/cert.pem`)) return;
  fs.writeFileSync(`${dir}/.san.cnf`, '[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=canvas.test\n[v3]\nsubjectAltName=DNS:canvas.test\n');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/key.pem`, '-out', `${dir}/cert.pem`, '-days', '30', '-config', `${dir}/.san.cnf`], { stdio: 'ignore' });
}

export async function start() {
  // A Chrome left over from an earlier run would still own this profile and the new one would join it.
  try {
    execFileSync('pkill', ['-9', '-f', `user-data-dir=${dir}/.profile`], { stdio: 'ignore' });
  } catch {
    /* none running */
  }
  await sleep(500);
  fs.rmSync(`${dir}/.profile`, { recursive: true, force: true });
  const browser = launch(CHROME, [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${dir}/.profile`,
    '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP canvas.test 127.0.0.1', '--ignore-certificate-errors', '--window-size=1300,900',
  ]);
  // Branded Chrome ignores --load-extension; this DevTools call is the supported way for test tooling.
  const { id } = await browser.send('Extensions.loadUnpacked', { path: EXTENSION });
  await sleep(1200);
  const { targetInfos } = await browser.send('Target.getTargets');
  const swInfo = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(id));
  if (!swInfo) throw new Error('The extension loaded but its background worker did not start (check the manifest).');
  const sw = await attach(browser, swInfo.targetId);
  const storage = () => sw.eval('chrome.storage.local.get(null)');
  const openTab = async (url) => {
    const { targetId } = await browser.send('Target.createTarget', { url });
    const page = await attach(browser, targetId);
    await page.call('Page.enable');
    return page;
  };
  const waitFor = async (fn, ms = 60000, label = 'condition') => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`);
      await sleep(300);
    }
  };
  return { browser, extId: id, sw, storage, openTab, waitFor };
}

export const text = (page) => page.eval('document.body.innerText');
export const panel = (page) => page.eval(`document.querySelector('[role=dialog]')?.innerText ?? ''`);
export const click = (page, re, sel = 'button') =>
  page.eval(`(() => { const b = [...document.querySelectorAll('${sel}')].find((b) => ${re}.test(b.textContent)); if (!b) throw new Error('no ${sel} matching ${re}'); b.click(); return true; })()`, { userGesture: true });
export const typeInto = (page, label, value) =>
  page.eval(`(() => { const i = document.querySelector('input[aria-label="${label}"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
export const go = (page, p) => page.eval(`(() => { history.pushState({}, '', ${JSON.stringify(p)}); dispatchEvent(new PopStateEvent('popstate')); })()`);
export const pageCount = async (h) => (await h.browser.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page').length;
// A full sync of the mock takes about 40 s; the wait is generous so a loaded machine does not read as a failure.
export const waitDone = (h, page, re = /Done\.|Stopped\./, ms = 300000) => h.waitFor(async () => re.test(await panel(page)), ms, 'the run to finish');

/** Opens the app signed out, types the Canvas address and presses Connect: the first sync runs by itself. */
export async function signIn(h) {
  const app = await h.openTab(APP);
  await h.waitFor(() => app.eval("document.readyState==='complete'"), 20000, 'the app to load');
  await h.waitFor(() => app.eval(`!!document.querySelector('input[aria-label="Your Canvas address"]')`), 20000, 'the login form');
  await typeInto(app, 'Your Canvas address', 'https://canvas.test:8443/');
  await click(app, /Connect and load/);
  await waitDone(h, app);
  await sleep(800);
  return app;
}
