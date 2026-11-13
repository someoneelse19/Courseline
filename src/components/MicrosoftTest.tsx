import { useState } from 'react';
import { useApi, useAuth } from '../context/AuthContext';
import { useVisibleCourses } from '../hooks/useCanvasData';
import { graphGet, signInMicrosoft } from '../lib/microsoft';
import { Card } from './ui';

// TEMPORARY (phase 0 of the Microsoft work): finds out what the school lets a student's Microsoft sign-in do, one
// permission at a time, so each feature is built only if it can work. Reports counts and yes/no only: no classmate's
// email or id is shown. To be replaced by the real Microsoft account card.

type Result = { state: 'idle' | 'running' } | { state: 'ok' | 'fail'; text: string };
const shapeOf = (s: string) => s.replace(/\d/g, '9').replace(/[a-z]/gi, 'A');
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const blocked = (message: string) => /AADSTS(65001|90094|90095|50105)|admin|consent/i.test(message);

export function MicrosoftTest() {
  const api = useApi();
  const { user } = useAuth();
  const courses = useVisibleCourses();
  const [steps, setSteps] = useState<Result[]>([{ state: 'idle' }, { state: 'idle' }, { state: 'idle' }]);
  const set = (i: number, r: Result) => setSteps((s) => s.map((x, j) => (j === i ? r : x)));
  const failure = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    return { state: 'fail' as const, text: blocked(message) ? `Needs admin approval (${message})` : message };
  };

  async function run() {
    let myShape = '';
    set(0, { state: 'running' });
    try {
      const account = await signInMicrosoft();
      myShape = shapeOf(account.username.split('@')[0]);
      set(0, { state: 'ok', text: `Signed in as ${account.name ?? ''} (${account.username})` });
    } catch (e) {
      set(0, failure(e));
      return;
    }

    set(1, { state: 'running' });
    try {
      const course = courses.data?.[0];
      if (!course) throw new Error('no course to take names from');
      const names = (await api.getCoursePeople(course.id)).filter((p) => p.id !== user?.id).slice(0, 5).map((p) => p.name);
      let found = 0;
      let withMail = 0;
      let idShaped = 0;
      for (const name of names) {
        const res = await graphGet<{ value: Array<{ displayName?: string; mail?: string; userPrincipalName?: string }> }>(
          `/users?$search=${encodeURIComponent(`"displayName:${name.replace(/"/g, '')}"`)}&$select=displayName,mail,userPrincipalName&$top=5`,
          ['User.ReadBasic.All'],
          { ConsistencyLevel: 'eventual' },
        );
        const exact = res.value.filter((u) => plain(u.displayName ?? '') === plain(name));
        if (exact.length !== 1) continue;
        found += 1;
        if (exact[0].mail || exact[0].userPrincipalName) withMail += 1;
        if (myShape && shapeOf((exact[0].userPrincipalName ?? '').split('@')[0]) === myShape) idShaped += 1;
      }
      set(1, { state: 'ok', text: `${course.name}: ${found} of ${names.length} classmates found by exact name; ${withMail} with an email; ${idShaped} with a username shaped like a student ID (like yours)` });
    } catch (e) {
      set(1, failure(e));
    }

    set(2, { state: 'running' });
    try {
      const recent = await graphGet<{ value: unknown[] }>('/me/drive/recent?$top=10', ['Files.Read']);
      set(2, { state: 'ok', text: `OneDrive readable: ${recent.value.length} recent files listed` });
    } catch (e) {
      set(2, failure(e));
    }
  }

  const labels = ['1. Sign in (your profile)', '2. School directory (classmates’ emails and ids)', '3. Your OneDrive files'];
  const tone = (r: Result) => (r.state === 'ok' ? 'text-green-700 dark:text-green-400' : r.state === 'fail' ? 'text-red-700 dark:text-red-400' : 'text-neutral-500 dark:text-neutral-400');
  return (
    <Card title="Microsoft test (temporary)">
      <p className="-mt-1 mb-3 text-sm text-neutral-500 dark:text-neutral-400">
        Checks what your school lets Courseline do with your Microsoft account, one permission at a time. A popup asks you to sign in and to approve each permission. It only shows counts: no one else’s email or id.
      </p>
      <button
        type="button"
        onClick={() => void run()}
        disabled={steps.some((s) => s.state === 'running')}
        className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
      >
        Run the Microsoft test
      </button>
      <ul className="mt-3 space-y-1.5 text-sm">
        {steps.map((r, i) => (
          <li key={i}>
            <span className="font-medium">{labels[i]}:</span>{' '}
            <span role="status" className={tone(r)}>
              {r.state === 'ok' || r.state === 'fail' ? r.text : r.state === 'running' ? 'running…' : 'not run'}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
