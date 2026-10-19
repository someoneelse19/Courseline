import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PullPanel } from '../components/PullPanel';
import { cancelPull, loadSnapshot, onOpenPlanRequest, onPullEvent, startPull, type PullItem, type PullStep } from '../extension/bridge';
import { t } from '../i18n';
import { workingCourses } from '../extension/extensionApi';
import { discoverLinks, pendingLinks, planLinks } from '../extension/linkDiscovery';
import type { FreshnessKey } from '../extension/extensionApi';
import { dashboardStep, MAX_RUN_STEPS, planCourse, planSync, stepForAddress, stepsForKind, type CourseRef, type Depth } from '../extension/pullPlan';

// Everything that opens Canvas pages goes through here. The student confirms inside the app (or the click that asked
// for it is the confirmation), watches a live preview, and can stop at any time. The extension opens the pages one
// at a time in background tabs; nothing is scheduled and nothing runs without this panel showing it.

export interface PullRow {
  step: PullStep;
  state: 'queued' | 'visiting' | 'done' | 'error';
  captured: number;
  items: PullItem[];
  error?: string;
}

export interface PullBuild {
  steps: PullStep[];
  /** How many pages there are in all, when this run opens only the first batch of them. */
  total?: number;
  /** Pages to open after these finish (for when the course list is only known once the dashboard has been opened). */
  more?: (depth: Depth) => Promise<PullStep[]>;
}

export interface PullRequest {
  title: string;
  build: (depth: Depth) => Promise<PullBuild>;
  /** Show the plan and wait for Start. When false, the click that asked for it was the confirmation. */
  confirm: boolean;
  /** Offer "essentials only". */
  depthChoice?: boolean;
  depth?: Depth;
}

export type PullPhase = 'confirm' | 'running' | 'done';

export interface PullState {
  phase: PullPhase;
  title: string;
  depth: Depth;
  depthChoice: boolean;
  planCount: number | null;
  /** All the pages found, when this run opens only a batch of them. */
  planTotal: number | null;
  /** Linked pages found but not opened yet, once a run has finished. */
  remaining: number | null;
  rows: PullRow[];
  message: string | null;
  cancelled: boolean;
}

interface PullValue {
  state: PullState | null;
  running: boolean;
  request: (req: PullRequest) => void;
  /** Open the plan for syncing the chosen courses. `confirm: false` starts at once. */
  requestSync: (opts?: { confirm?: boolean; depth?: Depth; depthChoice?: boolean }) => void;
  /** Open the internal links found in what has been captured (assignments, pages, discussions, quizzes, files). */
  requestDeepSync: () => void;
  refreshCourse: (course: CourseRef) => void;
  refreshKind: (course: CourseRef | null, key: FreshnessKey, label: string) => void;
  pullAddress: (input: string) => Promise<string | null>;
  setDepth: (depth: Depth) => void;
  start: () => void;
  stop: () => void;
  close: () => void;
}

const PullContext = createContext<PullValue | null>(null);

/** For tests that need the type of what usePull() returns. */
export type PullValueForTest = PullValue;

const BATCH = 80; // pages per run; the extension caps a run at the same number

/** The linked pages that have not been opened yet, for the courses the app works with. */
/** A plan longer than one run can hold is cut to fit, remembering how long it really was (the panel says so). */
function fit(build: PullBuild): PullBuild {
  if (build.steps.length <= MAX_RUN_STEPS) return build;
  return { ...build, steps: build.steps.slice(0, MAX_RUN_STEPS), total: build.total ?? build.steps.length };
}

async function pendingDeep() {
  const snapshot = await loadSnapshot();
  if (!snapshot) return { host: null as string | null, pending: [], names: new Map<number, string | null>() };
  const newest = [...snapshot.records].sort((a, b) => b.capturedAt - a.capturedAt)[0]?.host;
  const host = snapshot.canvasHost ?? newest ?? null;
  const courses = workingCourses(snapshot);
  const names = new Map(courses.map((c) => [c.id, c.name] as const));
  if (!host) return { host, pending: [], names };
  const links = discoverLinks(snapshot, host, new Set(courses.map((c) => c.id)));
  return { host, pending: pendingLinks(links, snapshot.visited, Date.now()), names };
}

async function context() {
  const snapshot = await loadSnapshot();
  const newest = snapshot ? [...snapshot.records].sort((a, b) => b.capturedAt - a.capturedAt)[0]?.host : null;
  const host = snapshot?.canvasHost ?? newest ?? null;
  const courses: CourseRef[] = snapshot ? workingCourses(snapshot).map((c) => ({ id: c.id, name: c.name })) : [];
  return { host, courses };
}

export function PullProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PullState | null>(null);
  const requestRef = useRef<PullRequest | null>(null);
  const launchingRef = useRef(false);
  const stoppedRef = useRef(false); // Stop was pressed for the run in progress, even if no page is open at this moment
  const planRef = useRef(new Map<Depth, PullBuild>()); // the plan shown for confirmation, reused when Start is pressed
  const runRef = useRef<{ runId: string | null; offset: number; more?: PullBuild['more']; stage: 1 | 2 } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const patch = useCallback((next: Partial<PullState>) => setState((s) => (s ? { ...s, ...next } : s)), []);

  const finish = useCallback((message?: string) => {
    runRef.current = null;
    setState((s) => (s ? { ...s, phase: 'done', message: message ?? s.message } : s));
    // Whatever the run was, say how many linked pages are still unopened, so the next batch is one click.
    void pendingDeep().then(
      ({ pending }) => setState((s) => (s && s.phase === 'done' ? { ...s, remaining: pending.length } : s)),
      () => {},
    );
  }, []);

  const begin = useCallback(
    async (steps: PullStep[], offset: number, more: PullBuild['more'] | undefined, stage: 1 | 2, continueFrom?: string) => {
      const started = await startPull(steps, continueFrom);
      if (!started.ok) return finish(started.error);
      runRef.current = { runId: started.runId, offset, more, stage };
    },
    [finish],
  );

  // Progress from the extension.
  useEffect(
    () =>
      onPullEvent((event) => {
        const run = runRef.current;
        if (!run || event.runId !== run.runId) return;
        if (event.type === 'pullProgress') {
          const at = run.offset + event.index;
          setState((s) => {
            if (!s) return s;
            const rows = s.rows.map((r, i) =>
              i !== at
                ? r
                : event.state === 'visiting'
                  ? { ...r, state: 'visiting' as const }
                  : {
                      ...r,
                      state: event.outcome?.error ? ('error' as const) : ('done' as const),
                      captured: event.outcome?.captured ?? 0,
                      items: event.outcome?.items ?? [],
                      error: event.outcome?.error,
                    },
            );
            return { ...s, rows };
          });
          return;
        }
        // pullDone
        if (event.error) return finish(event.error);
        if (event.cancelled || stoppedRef.current) {
          patch({ cancelled: true });
          return finish();
        }
        if (run.stage === 1 && run.more) {
          const depth = stateRef.current?.depth ?? 'everything';
          const offset = run.offset + event.results.length;
          void run.more(depth).then(
            (steps) => {
              if (stoppedRef.current) {
                patch({ cancelled: true });
                return finish();
              }
              if (!steps.length) return finish(t('Courseline could not find your courses on the dashboard, so it stopped there.'));
              setState((s) => (s ? { ...s, rows: [...s.rows, ...steps.map((step) => ({ step, state: 'queued' as const, captured: 0, items: [] }))] } : s));
              return begin(steps, offset, undefined, 2, run.runId ?? undefined);
            },
            (e: Error) => finish(e.message),
          );
          return;
        }
        finish();
      }),
    [begin, finish, patch],
  );

  const launch = useCallback(
    async (depth: Depth) => {
      const req = requestRef.current;
      if (!req || launchingRef.current) return; // a second click on Start while the first is still starting
      launchingRef.current = true;
      try {
        // The plan the student just confirmed, not a new one: rebuilding reads the whole store again, which can take
        // long enough for the click that pressed Start to stop counting as a click.
        const built = planRef.current.get(depth) ?? fit(await req.build(depth));
        if (!built.steps.length) return finish(t('There was nothing to open. Check your Canvas address and the courses you chose.'));
        setState((s) => (s ? { ...s, phase: 'running', rows: built.steps.map((step) => ({ step, state: 'queued' as const, captured: 0, items: [] })), message: null } : s));
        await begin(built.steps, 0, built.more, 1);
      } catch (e) {
        finish((e as Error).message);
      } finally {
        launchingRef.current = false;
      }
    },
    [begin, finish],
  );

  const request = useCallback(
    (req: PullRequest) => {
      if (stateRef.current?.phase === 'running') {
        patch({ message: t('A sync is already running. Stop it first, or wait for it to finish.') });
        return;
      }
      requestRef.current = req;
      stoppedRef.current = false;
      planRef.current = new Map();
      const depth = req.depth ?? 'everything';
      setState({ phase: 'confirm', title: req.title, depth, depthChoice: !!req.depthChoice, planCount: null, planTotal: null, remaining: null, rows: [], message: null, cancelled: false });
      if (!req.confirm) {
        void launch(depth);
        return;
      }
      void req.build(depth).then(
        (raw) => {
          const b = fit(raw);
          planRef.current.set(depth, b);
          setState((s) => (s && s.phase === 'confirm' ? { ...s, planCount: b.steps.length, planTotal: b.total ?? null } : s));
        },
        (e: Error) => finish(e.message),
      );
    },
    [finish, launch, patch],
  );

  const setDepth = useCallback(
    (depth: Depth) => {
      patch({ depth, planCount: null });
      void requestRef.current?.build(depth).then(
        (raw) => {
          const b = fit(raw);
          planRef.current.set(depth, b);
          setState((s) => (s && s.phase === 'confirm' ? { ...s, planCount: b.steps.length, planTotal: b.total ?? null } : s));
        },
        () => {},
      );
    },
    [patch],
  );

  const requestSync = useCallback<PullValue['requestSync']>(
    (opts = {}) =>
      request({
        title: t('Sync your courses'),
        confirm: opts.confirm ?? true,
        depthChoice: opts.depthChoice ?? true,
        depth: opts.depth,
        build: async (depth) => {
          const { host, courses } = await context();
          if (!host) throw new Error(t('Courseline does not know your Canvas address yet. Save it in Settings → Connection first.'));
          if (courses.length) return { steps: planSync(host, courses, depth) };
          // The courses are only known once the dashboard has been opened.
          return {
            steps: [dashboardStep(host)],
            more: async (d) => {
              const next = await context();
              return next.host && next.courses.length ? planSync(next.host, next.courses, d) : [];
            },
          };
        },
      }),
    [request],
  );

  const requestDeepSync = useCallback(
    () =>
      request({
        title: t('Pull linked pages'),
        confirm: true,
        build: async () => {
          const { host, pending, names } = await pendingDeep();
          if (!host) throw new Error(t('Courseline does not know your Canvas address yet. Save it in Settings → Connection first.'));
          return { steps: planLinks(pending, names, BATCH), total: pending.length };
        },
      }),
    [request],
  );

  const refreshCourse = useCallback<PullValue['refreshCourse']>(
    (course) =>
      request({
        title: t('Refresh {what}', { what: course.name ?? t('Course {id}', { id: course.id }) }),
        confirm: true,
        depthChoice: true,
        build: async (depth) => {
          const { host } = await context();
          if (!host) throw new Error(t('Courseline does not know your Canvas address yet.'));
          return { steps: planCourse(host, course, depth) };
        },
      }),
    [request],
  );

  const refreshKind = useCallback<PullValue['refreshKind']>(
    (course, key, label) =>
      request({
        title: t('Refresh {what}', { what: `${label.toLowerCase()}${course ? ` · ${course.name ?? t('Course {id}', { id: course.id })}` : ''}` }),
        confirm: false, // one page, and the click said what it was
        build: async () => {
          const { host } = await context();
          if (!host) throw new Error(t('Courseline does not know your Canvas address yet.'));
          return { steps: stepsForKind(host, course, key, label) };
        },
      }),
    [request],
  );

  const pullAddress = useCallback<PullValue['pullAddress']>(
    async (input) => {
      const { host } = await context();
      if (!host) return t('Courseline does not know your Canvas address yet. Save it first.');
      const result = stepForAddress(host, input);
      if (!result.ok) return result.error;
      request({ title: t('Pull a page'), confirm: false, build: async () => ({ steps: [result.step] }) });
      return null;
    },
    [request],
  );

  // The popup's "Sync in Courseline" button, with this page already open: show the plan, no reload.
  useEffect(() => onOpenPlanRequest(() => { if (stateRef.current?.phase !== 'running') requestSync(); }), [requestSync]);

  const start = useCallback(() => void launch(stateRef.current?.depth ?? 'everything'), [launch]);
  const stop = useCallback(() => {
    stoppedRef.current = true;
    patch({ message: t('Stopping after this page…') });
    void cancelPull();
  }, [patch]);
  const close = useCallback(() => {
    if (stateRef.current?.phase !== 'running') {
      requestRef.current = null;
      setState(null);
    }
  }, []);

  const value = useMemo<PullValue>(
    () => ({ state, running: state?.phase === 'running', request, requestSync, requestDeepSync, refreshCourse, refreshKind, pullAddress, setDepth, start, stop, close }),
    [state, request, requestSync, requestDeepSync, refreshCourse, refreshKind, pullAddress, setDepth, start, stop, close],
  );

  return (
    <PullContext.Provider value={value}>
      {children}
      <PullPanel />
    </PullContext.Provider>
  );
}

export function usePull(): PullValue {
  const ctx = useContext(PullContext);
  if (!ctx) throw new Error('usePull must be used inside <PullProvider>');
  return ctx;
}
