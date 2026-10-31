// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync('extension/inject.js', 'utf8');
const realSetTimeout = setTimeout;
const tick = () => new Promise((r) => realSetTimeout(r, 0));

let posted;
const onMessage = (e) => e.data?.source === 'courseline-capture' && posted.push(e.data);

function install(fetchImpl) {
  window.fetch = fetchImpl;
  delete window.__courselineCapture;
  new Function(source)();
}
const apiFetch = () => vi.fn(async () => new Response('while(1);[{"id":1}]', { status: 200, headers: { 'content-type': 'application/json' } }));
const call = async () => {
  await window.fetch('/api/v1/courses');
  await tick();
  await tick();
};

beforeEach(() => {
  posted = [];
  window.addEventListener('message', onMessage);
  document.body.className = '';
  delete window.ENV;
});
afterEach(() => {
  window.removeEventListener('message', onMessage);
  vi.useRealTimers();
});

describe('inject.js', () => {
  it('captures on a Canvas page recognised by its body class, on any domain', async () => {
    document.body.className = 'ic-app';
    install(apiFetch());
    await call();
    await tick();
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toEqual([{ id: 1 }]);
  });

  it('recognises Canvas by its ENV object', async () => {
    window.ENV = { current_user_id: '5' };
    install(apiFetch());
    await call();
    await tick();
    expect(posted).toHaveLength(1);
  });

  it('holds responses until Canvas is recognised, then releases them', async () => {
    install(apiFetch());
    await call();
    await tick();
    expect(posted).toHaveLength(0);
    document.body.className = 'ic-app';
    window.dispatchEvent(new Event('load'));
    await tick();
    expect(posted).toHaveLength(1);
  });

  it('discards everything on a page that never looks like Canvas', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    install(apiFetch());
    await call();
    vi.advanceTimersByTime(5000);
    document.body.className = 'ic-app'; // too late: the decision was made
    window.dispatchEvent(new Event('load'));
    await tick();
    expect(posted).toHaveLength(0);
  });

  it('ignores non-API requests and failed responses, and returns the real response untouched', async () => {
    document.body.className = 'ic-app';
    install(vi.fn(async (u) => new Response(u === '/nope' ? 'x' : '{}', { status: u === '/api/v1/bad' ? 500 : 200 })));
    const res = await window.fetch('/other');
    await window.fetch('/api/v1/bad');
    await tick();
    await tick();
    await tick();
    expect(posted).toHaveLength(0);
    expect(await res.text()).toBe('{}');
  });

  it('captures any /api/ read, but never a write or a GraphQL mutation', async () => {
    document.body.className = 'ic-app';
    install(vi.fn(async () => new Response('{"ok":1}', { status: 200 })));
    await window.fetch('/api/v1/anything/new');
    await window.fetch('/api/v1/courses/1/submissions', { method: 'POST', body: '{}' });
    await window.fetch('/api/graphql', { method: 'POST', body: JSON.stringify({ operationName: 'ChangeIt', query: 'mutation ChangeIt { go }' }) });
    await window.fetch('/api/graphql', { method: 'POST', body: JSON.stringify({ operationName: 'ReadIt', query: 'query ReadIt { x }' }) });
    await tick();
    await tick();
    await tick();
    const urls = posted.map((p) => new URL(p.url).pathname + (p.operation ? `#${p.operation}` : ''));
    expect(urls.sort()).toEqual(['/api/graphql#ReadIt', '/api/v1/anything/new']);
  });

  it('reports the page has gone quiet once its requests are done, and not while one is still in flight', async () => {
    document.body.className = 'ic-app';
    let release;
    const slow = new Promise((r) => (release = r));
    install(
      vi.fn(async (url) => {
        if (String(url).includes('slow')) await slow;
        return new Response('{"ok":1}', { status: 200 });
      }),
    );
    const idles = () => posted.filter((p) => p.type === 'idle').length;

    // Copies of the script from earlier tests are still attached to this fake window; let their timers run out.
    await new Promise((r) => realSetTimeout(r, 900));
    posted.length = 0;
    const fast = window.fetch('/api/v1/fast');
    const pending = window.fetch('/api/v1/slow');
    await fast;
    await new Promise((r) => realSetTimeout(r, 900));
    expect(idles()).toBe(0); // the slow request is still in flight

    release();
    await pending;
    await new Promise((r) => realSetTimeout(r, 900));
    expect(idles()).toBeGreaterThanOrEqual(1);
  }, 8000);

  it('never reports quiet on a page that is not Canvas', async () => {
    await new Promise((r) => realSetTimeout(r, 900));
    posted.length = 0;
    install(vi.fn(async () => new Response('{}', { status: 200 })));
    await window.fetch('/api/v1/x');
    await new Promise((r) => realSetTimeout(r, 900));
    expect(posted.some((p) => p.type === 'idle')).toBe(false);
  }, 8000);

  it('never clones or reads a response that is not a same-origin /api/ read (video, downloads, other sites)', async () => {
    document.body.className = 'ic-app';
    const clone = vi.fn(() => ({ text: async () => 'x' }));
    install(vi.fn(async () => ({ url: 'https://cdn.example.com/video.mp4', status: 200, clone })));
    await window.fetch('https://cdn.example.com/video.mp4');
    await window.fetch('/files/42/download');
    await tick();
    await tick();
    expect(clone).not.toHaveBeenCalled();
  });

  it('never copies or parses the body of a request that is not to this site’s /api/ (uploads, analytics, other sites)', async () => {
    document.body.className = 'ic-app';
    const parse = vi.spyOn(JSON, 'parse');
    const cloneRequest = vi.spyOn(Request.prototype, 'clone');
    install(vi.fn(async () => new Response('ok', { status: 200 })));
    await window.fetch(new Request('https://analytics.example.com/collect', { method: 'POST', body: '{"event":"view"}' }));
    await window.fetch('/files/upload', { method: 'POST', body: '{"name":"essay.pdf"}' });
    await tick();
    await tick();
    expect(cloneRequest).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
    cloneRequest.mockRestore();
  });

  it('does read a same-origin /api/ response (and only that)', async () => {
    document.body.className = 'ic-app';
    const clone = vi.fn(() => ({ text: async () => '{"ok":1}' }));
    install(vi.fn(async () => ({ url: `${location.origin}/api/v1/courses`, status: 200, clone })));
    await window.fetch('/api/v1/courses');
    await tick();
    await tick();
    expect(clone).toHaveBeenCalledTimes(1);
  });

  describe('the gaps a page could slip through', () => {
    // A stand-in XMLHttpRequest the capture script wraps, answering from `replies` without any network.
    let replies;
    class FakeXHR extends EventTarget {
      constructor() {
        super();
        this.responseType = '';
        this.status = 0;
      }
      open(method, url) {
        this.url = url;
      }
      send() {
        queueMicrotask(() => {
          const r = replies[new URL(this.url, location.href).pathname] ?? { status: 404, text: '' };
          this.status = r.status ?? 200;
          this.responseURL = new URL(this.url, location.href).href;
          this.responseText = this.responseType === '' || this.responseType === 'text' ? r.text : '';
          this.response = this.responseType === 'json' ? r.json : this.responseText;
          this.dispatchEvent(new Event('load'));
          this.dispatchEvent(new Event('loadend'));
        });
      }
    }
    const xhr = (method, url, { type = '', body } = {}) =>
      new Promise((resolve) => {
        const x = new XMLHttpRequest();
        x.responseType = type;
        x.open(method, url);
        x.addEventListener('loadend', () => resolve(x));
        x.send(body);
      });
    const gql = (operationName, query, extra = {}) => JSON.stringify({ operationName, ...(query ? { query } : {}), ...extra });
    const settle = async () => {
      for (let i = 0; i < 5; i++) await tick();
    };

    beforeEach(() => {
      replies = {};
      document.body.className = 'ic-app';
      globalThis.XMLHttpRequest = FakeXHR;
      window.XMLHttpRequest = FakeXHR;
    });

    it('reads an XHR in JSON mode, not only in text mode', async () => {
      install(vi.fn(async () => new Response('{}')));
      replies['/api/v1/courses/1/front_page'] = { json: { url: 'home', title: 'Home' } };
      await xhr('GET', '/api/v1/courses/1/front_page', { type: 'json' });
      await settle();
      expect(posted.find((p) => p.url.endsWith('/front_page'))?.body).toEqual({ url: 'home', title: 'Home' });
    });

    it('names a GraphQL read sent through XHR, and never keeps a mutation sent that way', async () => {
      install(vi.fn(async () => new Response('{}')));
      replies['/api/graphql'] = { text: '{"data":{"x":1}}' };
      await xhr('POST', '/api/graphql', { body: gql('GetThing', 'query GetThing { x }') });
      await xhr('POST', '/api/graphql', { body: gql('ChangeThing', 'mutation ChangeThing { x }') });
      await settle();
      const ops = posted.filter((p) => p.url.endsWith('/api/graphql')).map((p) => p.operation);
      expect(ops).toEqual(['GetThing']);
    });

    it('names a GraphQL read sent as a Request object, and never keeps a mutation sent that way', async () => {
      install(vi.fn(async (input) => new Response('{"data":{"x":1}}', { status: 200, headers: { 'content-type': 'application/json' } })));
      await window.fetch(new Request(`${location.origin}/api/graphql`, { method: 'POST', body: gql('ReadIt', 'query ReadIt { x }') }));
      await window.fetch(new Request(`${location.origin}/api/graphql`, { method: 'POST', body: gql('WriteIt', 'mutation WriteIt { x }') }));
      await settle();
      expect(posted.filter((p) => p.url.endsWith('/api/graphql')).map((p) => p.operation)).toEqual(['ReadIt']);
    });

    it('a persisted query (no query text) that is named like a change is treated as a mutation', async () => {
      install(vi.fn(async () => new Response('{"data":{"x":1}}', { status: 200 })));
      const apq = { extensions: { persistedQuery: { version: 1, sha256Hash: 'abc' } } };
      await window.fetch('/api/graphql', { method: 'POST', body: gql('UpdateDashboardPosition', null, apq) });
      await window.fetch('/api/graphql', { method: 'POST', body: gql('GetDashboard', null, apq) });
      await settle();
      expect(posted.filter((p) => p.url.endsWith('/api/graphql')).map((p) => p.operation)).toEqual(['GetDashboard']);
    });
  });
});

describe('inject.js: data Canvas builds into the page', () => {
  const at = (path) => window.history.replaceState({}, '', path);
  afterEach(() => {
    at('/');
    document.body.innerHTML = '';
  });

  it('reads the Grades page: ENV for the numbers, the table for the names, plus the course menu', async () => {
    at('/courses/9/grades');
    document.body.className = 'ic-app';
    document.body.innerHTML = `
      <nav id="section-tabs"><a href="/courses/9">Home</a><a href="/courses/9/grades">Grades</a></nav>
      <table id="grades_summary"><tbody>
        <tr class="student_assignment" id="submission_700">
          <th class="title"><a href="/courses/9/assignments/700/submissions/42">Problem set 1</a><div class="context">Homework</div></th>
          <td><span class="assignment_group_id">70</span></td>
        </tr>
        <tr class="student_assignment" id="submission_group-70"><th class="title">Homework</th></tr>
        <tr class="student_assignment" id="submission_group-71"><th class="title">Final exam</th></tr>
      </tbody></table>`;
    window.ENV = { current_user_id: '42', context_asset_string: 'course_9', assignment_groups: [{ id: '70', assignments: [{ id: '700' }] }], submissions: [{ assignment_id: '700', score: 8 }] };
    install(apiFetch());
    window.dispatchEvent(new Event('load'));
    await tick();
    const nav = posted.find((p) => p.page === 'courseNav');
    expect(nav).toMatchObject({ url: `${location.origin}/courses/9#page:courseNav`, body: { tabs: [{ href: '/courses/9' }, { href: '/courses/9/grades' }] } });
    const grades = posted.find((p) => p.page === 'gradesPage');
    expect(grades.body.assignments).toEqual([
      { id: '700', name: 'Problem set 1', html_url: `${location.origin}/courses/9/assignments/700`, assignment_group_id: '70', missing: false, late: false, score_statistics: undefined },
    ]);
    expect(grades.body.group_names).toEqual({ 70: 'Homework', 71: 'Final exam' }); // a group with no assignments too
    expect(grades.body.submissions).toEqual([{ assignment_id: '700', score: 8 }]);
  });

  it('reads the front page and the syllabus from ENV', async () => {
    at('/courses/9');
    window.ENV = { current_user_id: '42', context_asset_string: 'course_9', WIKI_PAGE: { url: 'home', title: 'Home', body: '<p>Hi</p>', front_page: true }, SYLLABUS_BODY: '<p>Outline</p>' };
    install(apiFetch());
    window.dispatchEvent(new Event('load'));
    await tick();
    expect(posted.find((p) => p.page === 'wikiPage').body).toMatchObject({ url: 'home', front_page: true });
    expect(posted.find((p) => p.page === 'syllabus').body).toEqual({ syllabus_body: '<p>Outline</p>' });
    expect(posted.some((p) => p.page === 'gradesPage')).toBe(false); // not the Grades page
  });

  it('reads nothing from a page that is not Canvas', async () => {
    at('/courses/9');
    window.ENV = undefined;
    document.body.innerHTML = '<nav id="section-tabs"><a href="/courses/9">Home</a></nav>';
    install(apiFetch());
    window.dispatchEvent(new Event('load'));
    await tick();
    expect(posted.filter((p) => p.page)).toEqual([]);
  });
});

describe('inject.js: modules, class statistics and who is signed in', () => {
  const at = (path) => window.history.replaceState({}, '', path);
  afterEach(() => {
    at('/');
    document.body.innerHTML = '';
  });

  it('reads the Modules page HTML: module names and each item\'s type, content id, title, link and indent', async () => {
    at('/courses/9/modules');
    document.body.innerHTML = `
      <div id="context_modules">
        <div class="context_module" data-module-id="50" aria-label="Unit 1">
          <div class="ig-header"><span class="name">Unit 1</span></div>
          <ul>
            <li id="context_module_item_501" class="context_module_item attachment indent_1 Attachment_77">
              <span class="item_name"><a class="title" href="/courses/9/modules/items/501">Notes.pdf</a><span class="url"></span></span>
            </li>
            <li id="context_module_item_503" class="context_module_item external_url indent_0 ExternalUrl_3">
              <span class="item_name"><a class="title" href="/courses/9/modules/items/503">Teams</a><span class="url">https://teams.example</span></span>
            </li>
          </ul>
        </div>
      </div>`;
    window.ENV = { current_user_id: '42', context_asset_string: 'course_9', current_user: { id: '42', display_name: 'Ada L', avatar_image_url: 'https://x/a.png' } };
    install(apiFetch());
    window.dispatchEvent(new Event('load'));
    await tick();
    const modules = posted.find((p) => p.page === 'modulesPage');
    expect(modules.body.modules).toEqual([
      {
        id: '50',
        name: 'Unit 1',
        position: 1,
        items: [
          { id: '501', canvas_type: 'Attachment', content_id: '77', title: 'Notes.pdf', html_url: `${location.origin}/courses/9/modules/items/501`, external_url: undefined, indent: 1, position: 1 },
          { id: '503', canvas_type: 'ExternalUrl', content_id: '3', title: 'Teams', html_url: `${location.origin}/courses/9/modules/items/503`, external_url: 'https://teams.example', indent: 0, position: 2 },
        ],
      },
    ]);
    // Only the id and display name of who is signed in; never the avatar or anything else in ENV.current_user.
    expect(posted.find((p) => p.page === 'currentUser')).toMatchObject({ url: `${location.origin}/#page:currentUser`, body: { id: '42', display_name: 'Ada L' } });
    expect(posted.find((p) => p.page === 'currentUser').body).not.toHaveProperty('avatar_image_url');
  });

  it('reads missing / late pills and the class statistics table on the Grades page', async () => {
    at('/courses/9/grades');
    document.body.innerHTML = `
      <table id="grades_summary"><tbody>
        <tr class="student_assignment" id="submission_700">
          <th class="title"><a href="/courses/9/assignments/700">Set 1</a></th><td class="status"><span class="submission-late-pill">late</span></td>
        </tr>
        <tr id="grade_info_700"><td><table id="score_details_700" class="score_details_table"><tbody><tr>
          <td>Promedio: 6.5 Mediana: 7</td><td>Alto: 10 Cuartil superior: 8.25</td><td>Bajo: 1 Cuartil inferior: 4.5</td>
        </tr></tbody></table></td></tr>
        <tr class="student_assignment" id="submission_701">
          <th class="title"><a href="/courses/9/assignments/701">Set 2</a></th><td class="status"><span class="submission-missing-pill">missing</span></td>
        </tr>
      </tbody></table>`;
    window.ENV = { current_user_id: '42', context_asset_string: 'course_9', assignment_groups: [], submissions: [] };
    install(apiFetch());
    window.dispatchEvent(new Event('load'));
    await tick();
    const [set1, set2] = posted.find((p) => p.page === 'gradesPage').body.assignments;
    expect(set1).toMatchObject({ late: true, missing: false, score_statistics: { mean: 6.5, median: 7, max: 10, upper_q: 8.25, min: 1, lower_q: 4.5 } });
    expect(set2).toMatchObject({ late: false, missing: true, score_statistics: undefined });
  });
});

describe('inject.js: whose Grades page, and numbers in the page language', () => {
  const at = (path) => window.history.replaceState({}, '', path);
  const table = `<table id="grades_summary"><tbody>
    <tr class="student_assignment" id="submission_700"><th class="title"><a href="/courses/9/assignments/700">Set 1</a></th></tr>
    <tr id="grade_info_700"><td><table id="score_details_700"><tbody><tr>
      <td>Mean: 1,234.5 Median: 1,300</td><td>High: 2,000 Upper: 1,500.25</td><td>Low: 10 Lower: 900</td>
    </tr></tbody></table></td></tr></tbody></table>`;
  afterEach(() => {
    at('/');
    document.body.innerHTML = '';
    document.documentElement.lang = '';
  });
  const run = async (path, env) => {
    at(path);
    document.documentElement.lang = 'en';
    document.body.innerHTML = table;
    window.ENV = { context_asset_string: 'course_9', assignment_groups: [], submissions: [], ...env };
    install(apiFetch());
    window.dispatchEvent(new Event('load'));
    await tick();
    return posted.find((p) => p.page === 'gradesPage');
  };

  it('reads the student\'s own grades at /grades/<their id>, never anyone else\'s', async () => {
    expect(await run('/courses/9/grades/42', { current_user_id: '42' })).toBeTruthy();
    posted = [];
    expect(await run('/courses/9/grades/43', { current_user_id: '42' })).toBeUndefined();
    posted = [];
    expect(await run('/courses/9/grades', { current_user_id: '42', student_id: '43' })).toBeUndefined(); // an observer's view
  });

  it('reads Canvas\'s decimal points on a Spanish page (6.88 is not 688)', async () => {
    at('/courses/9/grades');
    document.documentElement.lang = 'es';
    document.body.innerHTML = table.replace('Mean: 1,234.5 Median: 1,300', 'Promedio: 6.17 Mediana: 6.88').replace('High: 2,000 Upper: 1,500.25', 'Alto: 10 Cuartil superior: 9.56').replace('Low: 10 Lower: 900', 'Bajo: 0 Cuartil inferior: 3,75');
    window.ENV = { context_asset_string: 'course_9', assignment_groups: [], submissions: [], current_user_id: '42' };
    install(apiFetch());
    window.dispatchEvent(new Event('load'));
    await tick();
    expect(posted.find((p) => p.page === 'gradesPage').body.assignments[0].score_statistics).toEqual({ mean: 6.17, median: 6.88, max: 10, upper_q: 9.56, min: 0, lower_q: 3.75 });
  });

  it('reads grouped numbers as the page\'s language writes them, and records the grading period', async () => {
    const grades = await run('/courses/9/grades?grading_period_id=12', { current_user_id: '42' });
    expect(grades.body.assignments[0].score_statistics).toEqual({ mean: 1234.5, median: 1300, max: 2000, upper_q: 1500.25, min: 10, lower_q: 900 });
    expect(grades.body.grading_period_id).toBe('12');
  });

  it('reads Canvas\'s own total and weighting scheme from the Grades page; nothing for points-only or hidden totals', async () => {
    const total = async (text, env = {}) => {
      posted = [];
      at('/courses/9/grades');
      // The Total row is the last row of the summary table.
      const row = text === null ? '' : `<tr class="student_assignment final_grade" id="submission_final-grade"><th class="title">Total</th><td class="assignment_score"><span class="grade">${text}</span></td></tr>`;
      document.body.innerHTML = table.replace(/<\/tbody><\/table>$/, `${row}</tbody></table>`);
      window.ENV = { context_asset_string: 'course_9', assignment_groups: [], submissions: [], current_user_id: '42', ...env };
      install(apiFetch());
      window.dispatchEvent(new Event('load'));
      await tick();
      return posted.find((p) => p.page === 'gradesPage').body;
    };
    expect((await total('70%')).canvas_total).toBe(70);
    expect((await total('85,5 %')).canvas_total).toBe(85.5);
    expect((await total('17.5 / 20')).canvas_total).toBeUndefined();
    expect((await total(null)).canvas_total).toBeUndefined();
    expect((await total('70% / 80%')).canvas_total).toBeUndefined(); // two numbers: not sure which
    expect((await total('70%', { group_weighting_scheme: 'percent' })).group_weighting_scheme).toBe('percent');
    expect((await total('70%', { group_weighting_scheme: 5 })).group_weighting_scheme).toBeUndefined();
  });

  it('reads the total again once Canvas\'s own JavaScript has filled it in, and sends the Grades page again only then', async () => {
    at('/courses/9/grades');
    // As the server sends it: the Total cell is empty until the page's grade calculator runs.
    document.body.innerHTML = table.replace(/<\/tbody><\/table>$/, '<tr class="student_assignment final_grade" id="submission_final-grade"><th class="title">Total</th><td><span class="grade"></span></td></tr></tbody></table>');
    window.ENV = { context_asset_string: 'course_9', assignment_groups: [], submissions: [], current_user_id: '42' };
    install(apiFetch());
    document.body.className = 'ic-app';
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await tick();
    const sends = () => posted.filter((p) => p.page === 'gradesPage');
    expect(sends()).toHaveLength(1);
    expect(sends()[0].body.canvas_total).toBeUndefined();
    document.querySelector('#submission_final-grade .grade').textContent = '72%';
    window.dispatchEvent(new Event('load'));
    await tick();
    expect(sends()).toHaveLength(2);
    expect(sends()[1]).toMatchObject({ url: `${location.origin}/courses/9#page:gradesPage`, body: { canvas_total: 72 } });
    window.dispatchEvent(new Event('load'));
    await tick();
    expect(sends()).toHaveLength(2); // unchanged: not sent again
  });
});

describe('inject.js: module items Canvas draws after loading', () => {
  const at = (path) => window.history.replaceState({}, '', path);
  afterEach(() => {
    at('/');
    document.body.innerHTML = '';
  });

  it('reads the Modules page again on load, and sends it only when it changed', async () => {
    at('/courses/9/modules');
    document.body.innerHTML = '<div id="context_modules"><div class="context_module" data-module-id="50"><div class="ig-header"><span class="name">Unit 1</span></div><ul id="items"></ul></div></div>';
    window.ENV = { current_user_id: '42', context_asset_string: 'course_9' };
    install(apiFetch());
    document.body.className = 'ic-app';
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await tick();
    expect(posted.filter((p) => p.page === 'modulesPage').at(-1).body.modules[0].items).toEqual([]);
    // Canvas renders the items afterwards.
    document.getElementById('items').innerHTML = '<li id="context_module_item_501" class="context_module_item Attachment_77"><span class="item_name"><a class="title" href="/courses/9/modules/items/501">Notes.pdf</a></span></li>';
    window.dispatchEvent(new Event('load'));
    await tick();
    const sends = posted.filter((p) => p.page === 'modulesPage');
    expect(sends.at(-1).body.modules[0].items.map((i) => i.title)).toEqual(['Notes.pdf']);
    window.dispatchEvent(new Event('load'));
    await tick();
    expect(posted.filter((p) => p.page === 'modulesPage')).toHaveLength(sends.length); // unchanged: not sent again
  });
});

describe('inject.js: unit item titles as students see them', () => {
  const at = (path) => window.history.replaceState({}, '', path);
  afterEach(() => {
    at('/');
    document.body.innerHTML = '';
  });

  it('drops screen-reader text from titles, and takes an external link straight from the title link', async () => {
    at('/courses/9/modules');
    document.body.innerHTML = `<div id="context_modules"><div class="context_module" data-module-id="50"><div class="ig-header"><span class="name">U</span></div><ul>
      <li id="context_module_item_7" class="context_module_item external_url ExternalUrl_3"><span class="item_name"><a class="title external" href="https://teams.example/x">Teams<span class="screenreader-only">Links to an external site.</span></a><span class="url"></span></span></li>
    </ul></div></div>`;
    window.ENV = { current_user_id: '42', context_asset_string: 'course_9' };
    install(apiFetch());
    window.dispatchEvent(new Event('load'));
    await tick();
    const [item] = posted.filter((p) => p.page === 'modulesPage').at(-1).body.modules[0].items;
    expect(item).toMatchObject({ title: 'Teams', external_url: 'https://teams.example/x', html_url: undefined });
  });
});

describe('inject.js: sending a message the student wrote in Courseline', () => {
  // As a real browser delivers it (jsdom's postMessage leaves source and origin empty, which inject.js refuses).
  const command = (extra) =>
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'courseline-command', type: 'send', nonce: 'n1', ...extra }, source: window, origin: location.origin }));
  const result = async () => {
    for (let i = 0; i < 20 && !posted.some((p) => p.type === 'sendResult'); i++) await tick();
    return posted.find((p) => p.type === 'sendResult');
  };
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('makes Canvas\'s own request with the page\'s form token, and passes the answer back', async () => {
    window.ENV = { current_user_id: '42' };
    document.body.innerHTML = '<form><input name="authenticity_token" value="tok123"></form>';
    const fetchImpl = vi.fn(async () => new Response('while(1);{"id":8,"messages":[{"id":1,"body":"hi"}]}', { status: 200 }));
    install(fetchImpl);
    command({ path: '/api/v1/conversations/8/add_message', payload: { body: 'hi' } });
    const r = await result();
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, nonce: 'n1', body: { id: 8 } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/v1/conversations/8/add_message');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{"body":"hi"}' });
    expect(init.headers['X-CSRF-Token']).toBe('tok123');
  });

  it('refuses any other request, and a page with no form token', async () => {
    window.ENV = { current_user_id: '42' };
    document.body.innerHTML = '<input name="authenticity_token" value="tok">';
    const fetchImpl = vi.fn(async () => new Response('{}'));
    install(fetchImpl);
    command({ path: '/api/v1/users/self', payload: {} });
    expect(await result()).toMatchObject({ ok: false, error: 'Not a message request.' });
    posted = [];
    document.body.innerHTML = '';
    command({ path: '/api/v1/conversations', payload: { body: 'x' } });
    expect((await result()).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('inject.js: attachments sent from Courseline', () => {
  const command = (extra) =>
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'courseline-command', type: 'send', nonce: 'n2', ...extra }, source: window, origin: location.origin }));
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('uploads each file the way Canvas does, then sends the message with their ids', async () => {
    window.ENV = { current_user_id: '42' };
    document.body.innerHTML = '<input name="authenticity_token" value="tok">';
    const fetchImpl = vi.fn(async (url) => {
      if (url === '/api/v1/users/self/files') return new Response('{"upload_url":"https://storage.test/up","upload_params":{"key":"k"}}');
      if (String(url).startsWith('https://storage.test/')) return new Response('{"id":77}', { status: 201 });
      return new Response('{"id":8}');
    });
    install(fetchImpl);
    command({ path: '/api/v1/conversations/8/add_message', payload: { body: 'hi' }, files: [{ name: 'a.txt', type: 'text/plain', data: btoa('hello') }] });
    for (let i = 0; i < 30 && !posted.some((p) => p.type === 'sendResult' && p.nonce === 'n2'); i++) await tick();
    expect(posted.find((p) => p.nonce === 'n2')).toMatchObject({ ok: true });
    const [slot, upload, message] = fetchImpl.mock.calls;
    expect(JSON.parse(slot[1].body)).toMatchObject({ name: 'a.txt', size: 5, parent_folder_path: 'conversation attachments' });
    expect(upload[1]).toMatchObject({ method: 'POST', credentials: 'omit' }); // file storage on another host gets no cookies
    expect([...upload[1].body.keys()]).toEqual(['key', 'file']);
    expect(JSON.parse(message[1].body)).toEqual({ body: 'hi', attachment_ids: ['77'] });
  });
});

describe('inject.js: reading messages for Courseline', () => {
  it('reads both folders and each thread without marking anything read', async () => {
    window.ENV = { current_user_id: '42' };
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('scope=inbox')) return new Response('while(1);[{"id":8,"subject":"Pi"}]');
      if (String(url).includes('scope=sent')) return new Response('[{"id":9,"subject":"Q"}]');
      return new Response(`{"id":${String(url).match(/conversations\/(\d+)/)[1]},"messages":[]}`);
    });
    install(fetchImpl);
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'courseline-command', type: 'mail', nonce: 'm1' }, source: window, origin: location.origin }));
    for (let i = 0; i < 30 && !posted.some((p) => p.type === 'mailResult'); i++) await tick();
    const r = posted.find((p) => p.type === 'mailResult');
    expect(r).toMatchObject({ ok: true, lists: { inbox: [{ id: 8 }], sent: [{ id: 9 }] } });
    expect(r.threads.map((c) => c.id)).toEqual([8, 9]);
    const urls = fetchImpl.mock.calls.map(([u]) => u);
    expect(urls.filter((u) => /conversations\/\d+/.test(u)).every((u) => u.includes('auto_mark_as_read=false'))).toBe(true);
    expect(fetchImpl.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });
});

describe('inject.js: an assignment page Canvas renders on the server', () => {
  const at = (path) => window.history.replaceState({}, '', path);
  afterEach(() => {
    at('/');
    document.body.innerHTML = '';
  });
  // The page as a school's Canvas draws it (live, Oct 2026): title, a localized date list, then the instructions.
  const skeleton = (title, description) => `
    <div id="assignment_show" class="assignment">
      <div class="assignment-title"><div class="title-content"><h1 class="title">
        ${title}
      </h1></div></div>
      <ul class="student-assignment-overview">
        <li><span class="title">Fecha de entrega</span><span class="value"><span class="date_text"><span class="display_date">20 de oct</span><span class="display_time">a las 11:15</span></span></span></li>
        <li><span class="title">Puntos</span><span class="value">10</span></li>
        <li><span class="title">Entregando</span><span class="value">un archivo</span></li>
      </ul>
      ${description === null ? '' : `<div class="description user_content enhanced">${description}</div>`}
    </div>`;
  const read = async (path, env, html) => {
    at(path);
    document.body.innerHTML = html;
    window.ENV = { current_user_id: '42', context_asset_string: 'course_4', ...env };
    install(apiFetch());
    window.dispatchEvent(new Event('load'));
    await tick();
    return posted.find((p) => p.page === 'assignmentPage');
  };
  const criteria = [{ id: 'c1', description: 'Procedimiento', long_description: 'Cada paso', points: 10, ratings: [{ id: 'r1a', description: 'Completo', points: 10 }, { id: 'r1b', description: 'Nada', long_description: '', points: '0' }] }];

  it('reads the title, instructions, points and rubric, with the ids and link, from the page and ENV', async () => {
    const sent = await read(
      '/courses/4/assignments/41',
      { ASSIGNMENT_ID: '41', COURSE_ID: '4', ASSIGNMENT_POINTS_POSSIBLE: 10, CONTEXT_TIMEZONE: 'Europe/Madrid', assigned_rubric: { id: 'r1', data: criteria } },
      skeleton('Ecuaciones', '<p>Resuelve los ejercicios.</p>'),
    );
    expect(sent.url).toBe(`${location.origin}/courses/4#page:assignmentPage`);
    expect(sent.body).toEqual({
      id: '41',
      course_id: '4',
      name: 'Ecuaciones',
      html_url: `${location.origin}/courses/4/assignments/41`,
      description: '<p>Resuelve los ejercicios.</p>',
      points_possible: 10,
      rubric: [
        {
          id: 'c1',
          description: 'Procedimiento',
          long_description: 'Cada paso',
          points: 10,
          ratings: [{ id: 'r1a', description: 'Completo', points: 10 }, { id: 'r1b', description: 'Nada', points: 0 }],
        },
      ],
    });
    // Never the localized date text, and no date of its own: the due date comes from the Grades page.
    expect(JSON.stringify(sent.body)).not.toContain('20 de oct');
    expect(JSON.stringify(sent.body)).not.toContain('11:15');
    expect(JSON.stringify(sent.body)).not.toContain('due_at');
  });

  it('reads criteria from assigned_rubric.criteria too, and marks a rubric it cannot read', async () => {
    let sent = await read('/courses/4/assignments/41', { ASSIGNMENT_ID: '41', ASSIGNMENT_POINTS_POSSIBLE: '7.5', assigned_rubric: { criteria } }, skeleton('A', '<p>x</p>'));
    expect(sent.body.rubric.map((c) => c.id)).toEqual(['c1']);
    expect(sent.body.points_possible).toBe(7.5);
    posted = [];
    sent = await read('/courses/4/assignments/41', { ASSIGNMENT_ID: '41', assigned_rubric: { data: [{ id: 'c1', points: 'diez', ratings: [] }] } }, skeleton('A', '<p>x</p>'));
    expect(sent.body).not.toHaveProperty('rubric');
    expect(sent.body.rubric_unreadable).toBe(true);
    posted = [];
    sent = await read('/courses/4/assignments/41', { ASSIGNMENT_ID: '41', ASSIGNMENT_POINTS_POSSIBLE: 'diez', assigned_rubric: { data: [{ id: 'c1', points: 1 }] } }, skeleton('A', '<p>x</p>'));
    expect(sent.body.rubric_unreadable).toBe(true);
    expect(sent.body).not.toHaveProperty('points_possible');
  });

  it('sends nothing when the address and ENV.ASSIGNMENT_ID disagree, or there is no #assignment_show', async () => {
    expect(await read('/courses/4/assignments/41', { ASSIGNMENT_ID: '42' }, skeleton('A', ''))).toBeUndefined();
    posted = [];
    expect(await read('/courses/4/assignments/41', { ASSIGNMENT_ID: '41', COURSE_ID: '5' }, skeleton('A', ''))).toBeUndefined();
    posted = [];
    expect(await read('/courses/4/assignments/41', { ASSIGNMENT_ID: '41' }, '<div id="content"><h1 class="title">A</h1></div>')).toBeUndefined();
    posted = [];
    expect(await read('/courses/4/assignments/41', { ASSIGNMENT_ID: '41' }, skeleton('   ', ''))).toBeUndefined(); // no title
    posted = [];
    expect(await read('/courses/4/assignments/41/submissions/42', { ASSIGNMENT_ID: '41' }, skeleton('A', ''))).toBeUndefined();
    posted = [];
    // Another course's assignment on a page ENV files under course 4.
    expect(await read('/courses/5/assignments/41', { ASSIGNMENT_ID: '41' }, skeleton('A', ''))).toBeUndefined();
  });

  it('leaves out the rubric when ENV has none, and keeps an empty description as empty', async () => {
    let sent = await read('/courses/4/assignments/42', { ASSIGNMENT_ID: 42, assigned_rubric: null }, skeleton('Práctica', '  '));
    expect(sent.body).toEqual({ id: '42', course_id: '4', name: 'Práctica', html_url: `${location.origin}/courses/4/assignments/42`, description: '' });
    posted = [];
    // No instructions element at all: the key is left out (unknown), not ''.
    sent = await read('/courses/4/assignments/42', { ASSIGNMENT_ID: '42' }, skeleton('Práctica', null));
    expect(sent.body).not.toHaveProperty('description');
    expect(sent.body).not.toHaveProperty('rubric_unreadable');
  });

  it('drops the screen-reader text Canvas adds inside the instructions', async () => {
    const sent = await read(
      '/courses/4/assignments/41',
      { ASSIGNMENT_ID: '41' },
      skeleton('A', '<p><a class="external" href="https://example.org">Guía<span class="external_link_icon"><svg></svg><span class="screenreader-only">Enlaces a un sitio externo.</span></span></a><span class="ui-helper-hidden-accessible">oculto</span></p>'),
    );
    expect(sent.body.description).toBe('<p><a class="external" href="https://example.org">Guía</a></p>');
  });

  it('says a Discussions or Announcements page opened only when the page really is that page (not the course home it redirected to)', async () => {
    const open = async (path) => {
      posted = [];
      at(path);
      window.ENV = { current_user_id: '42', context_asset_string: 'course_4' };
      install(apiFetch());
      window.dispatchEvent(new Event('load'));
      await tick();
      return posted.filter((p) => p.page === 'listPage');
    };
    expect((await open('/courses/4/discussion_topics')).map((p) => [p.url, p.body])).toEqual([[`${location.origin}/courses/4#page:listPage`, { path: 'discussion_topics' }]]);
    expect((await open('/courses/4/announcements/')).map((p) => p.body)).toEqual([{ path: 'announcements' }]);
    expect(await open('/courses/4')).toEqual([]); // where a hidden tab lands
    expect(await open('/courses/4/discussion_topics/900')).toEqual([]);
    expect(await open('/courses/4/modules')).toEqual([]);
  });
});
