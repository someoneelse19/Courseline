import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The inline script in index.html runs before the app: it moves settings saved under the old product name, then
// applies the saved theme and accent before first paint. This runs that exact script.
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8'); // tests run from the project root
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const run = () => new Function(script)();

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
});

describe('index.html first-paint script', () => {
  it('moves better-canvas.* settings to courseline.* and removes the old keys', () => {
    localStorage.setItem('better-canvas.credentials', '{"baseUrl":"https://school.test","token":"T"}');
    localStorage.setItem('better-canvas.pages.12', '{"order":["a"],"collapsed":[]}');
    localStorage.setItem('theme', 'light');
    run();
    expect(localStorage.getItem('courseline.credentials')).toBe('{"baseUrl":"https://school.test","token":"T"}');
    expect(localStorage.getItem('courseline.pages.12')).toBe('{"order":["a"],"collapsed":[]}');
    expect(localStorage.getItem('better-canvas.credentials')).toBeNull();
    expect(localStorage.getItem('better-canvas.pages.12')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('light'); // never had the prefix
  });

  it('never overwrites a setting already saved under the new name', () => {
    localStorage.setItem('courseline.accent', '#16a34a');
    localStorage.setItem('better-canvas.accent', '#dc2626');
    run();
    expect(localStorage.getItem('courseline.accent')).toBe('#16a34a');
    expect(localStorage.getItem('better-canvas.accent')).toBeNull();
  });

  it('applies a migrated accent palette and the dark theme in the same pass', () => {
    localStorage.setItem('better-canvas.accent-vars', JSON.stringify({ '--accent-600': '22 163 74' }));
    localStorage.setItem('theme', 'dark');
    run();
    expect(document.documentElement.style.getPropertyValue('--accent-600')).toBe('22 163 74');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
