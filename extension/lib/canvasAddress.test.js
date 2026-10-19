import { describe, expect, it } from 'vitest';
import { applyCanvasAddress, keysToClearOnSwitch, parseCanvasAddress } from './canvasAddress.js';

describe('parseCanvasAddress', () => {
  it('reduces any reasonable form to the host', () => {
    for (const input of ['https://School.Instructure.com/', 'school.instructure.com', ' https://school.instructure.com/courses/1?x=1#y ']) {
      expect(parseCanvasAddress(input)).toEqual({ ok: true, host: 'school.instructure.com' });
    }
    expect(parseCanvasAddress('https://canvas.school.edu:8443/')).toEqual({ ok: true, host: 'canvas.school.edu:8443' });
  });

  it('treats empty as "detect it"', () => {
    expect(parseCanvasAddress('   ')).toEqual({ ok: true, host: null });
  });

  it('refuses http, credentials, and things that are not addresses', () => {
    expect(parseCanvasAddress('http://school.instructure.com')).toMatchObject({ ok: false });
    expect(parseCanvasAddress('https://me:pw@school.instructure.com')).toMatchObject({ ok: false });
    expect(parseCanvasAddress('school')).toMatchObject({ ok: false });
    expect(parseCanvasAddress('not an address')).toMatchObject({ ok: false });
    expect(parseCanvasAddress('javascript://x')).toMatchObject({ ok: false });
  });
});

describe('keysToClearOnSwitch', () => {
  it('drops captures from another address and the settings tied to it, but keeps matching ones', () => {
    const all = {
      'cap:old': { host: 'old.test' },
      'cap:new': { host: 'new.test' },
      health: {},
      pinned: [1],
      appPinned: [1],
      canvasHost: 'old.test',
      theme: 'x',
    };
    const keys = keysToClearOnSwitch(all, 'new.test');
    expect(keys).toEqual(expect.arrayContaining(['cap:old', 'health', 'pinned', 'appPinned']));
    expect(keys).not.toContain('cap:new');
    expect(keys).not.toContain('canvasHost');
    expect(keys).not.toContain('theme');
  });
});

function fakeStorage(initial) {
  const data = { ...initial };
  return {
    data,
    get: async () => ({ ...data }),
    set: async (o) => void Object.assign(data, o),
    remove: async (k) => void [].concat(k).forEach((key) => delete data[key]),
  };
}

describe('applyCanvasAddress', () => {
  it('saves a first address without touching what is there for it', async () => {
    const st = fakeStorage({ 'cap:a': { host: 'school.test' } });
    expect(await applyCanvasAddress(st, 'https://school.test/')).toEqual({ ok: true, host: 'school.test', cleared: 0 });
    expect(st.data.canvasHost).toBe('school.test');
    expect(st.data['cap:a']).toBeDefined();
  });

  it('clears the old address\'s data when switching, and keeps the new address saved', async () => {
    const st = fakeStorage({ canvasHost: 'old.test', 'cap:a': { host: 'old.test' }, health: {}, pinned: [1], appPinned: [1] });
    const res = await applyCanvasAddress(st, 'new.test');
    expect(res).toMatchObject({ ok: true, host: 'new.test' });
    expect(st.data).toEqual({ canvasHost: 'new.test' });
  });

  it('forgets the address when empty, and refuses a bad one without changing anything', async () => {
    const st = fakeStorage({ canvasHost: 'school.test' });
    expect(await applyCanvasAddress(st, 'http://nope.test')).toMatchObject({ ok: false });
    expect(st.data.canvasHost).toBe('school.test');
    expect(await applyCanvasAddress(st, '')).toEqual({ ok: true, host: null, cleared: 0 });
    expect(st.data.canvasHost).toBeUndefined();
  });
});
