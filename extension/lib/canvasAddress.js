// Pure: the Canvas address the student types into the popup, and what changing it should clear.

/**
 * @returns {{ok: true, host: string|null} | {ok: false, error: string}}
 * Accepts "https://school.instructure.com/", "school.instructure.com" or "school.example.edu/courses/1". Empty means
 * "no address: nothing is captured until one is saved". Canvas is always https, so anything else is refused rather than guessed at.
 */
export function parseCanvasAddress(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: true, host: null };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https:\/\//i.test(raw)) {
    return { ok: false, error: 'Canvas uses https. Start the address with https:// or leave the prefix off.' };
  }
  let url;
  try {
    url = new URL(/^https:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: 'That does not look like a web address.' };
  }
  if (url.username || url.password) return { ok: false, error: 'Leave out any user name or password.' };
  const host = url.host.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/.test(host)) {
    return { ok: false, error: 'That does not look like a Canvas address (for example school.instructure.com).' };
  }
  return { ok: true, host };
}

/** Storage keys to delete when switching to `host`: everything captured from another address, and what depends on it. */
export function keysToClearOnSwitch(all, host) {
  const foreign = Object.entries(all)
    .filter(([key, rec]) => key.startsWith('cap:') && rec?.host !== host)
    .map(([key]) => key);
  return [...foreign, 'health', 'pinned', 'appPinned', 'unmapped', 'shapes'].filter((k) => k in all || foreign.includes(k));
}

/**
 * Saves (or clears) the Canvas address in `storage` (anything shaped like chrome.storage.local).
 * Switching to a different address first removes what was captured from the old one. Used by the popup and by the
 * Courseline app (through the bridge), so both behave identically.
 * @returns {Promise<{ok: true, host: string|null, cleared: number} | {ok: false, error: string}>}
 */
export async function applyCanvasAddress(storage, input) {
  const parsed = parseCanvasAddress(input);
  if (!parsed.ok) return parsed;
  const all = await storage.get(null);
  if (parsed.host === null) {
    await storage.remove('canvasHost');
    return { ok: true, host: null, cleared: 0 };
  }
  let cleared = 0;
  if (all.canvasHost !== parsed.host) {
    const drop = keysToClearOnSwitch(all, parsed.host).filter((k) => k !== 'canvasHost');
    if (drop.length) await storage.remove(drop);
    cleared = drop.length;
  }
  await storage.set({ canvasHost: parsed.host });
  return { ok: true, host: parsed.host, cleared };
}
