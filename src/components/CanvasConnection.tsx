import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useOptionalCourseFilter } from '../context/CourseFilterContext';
import { usePull } from '../context/PullContext';
import { useExtensionSetup } from '../extension/useExtensionSetup';
import { t, tn } from '../i18n';
import { formatAgo } from '../lib/format';

const input = 'w-full min-w-0 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950';
const primary = 'rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-60';
const secondary = 'rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800';

function InstallSteps() {
  return (
    <div className="space-y-2 text-sm">
      <p>{t('To use Courseline without an access token, install the Courseline browser extension:')}</p>
      <ol className="list-decimal space-y-1 pl-5 text-neutral-600 dark:text-neutral-300">
        <li>{t('Open chrome://extensions and turn on Developer mode.')}</li>
        <li>{t('Choose “Load unpacked” and pick the extension folder inside the Courseline project.')}</li>
        <li>{t('Reload this page.')}</li>
      </ol>
    </div>
  );
}

function Step({ done, title, children }: { done: boolean; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done ? 'bg-green-600 text-white' : 'border border-neutral-300 text-neutral-400 dark:border-neutral-600'
        }`}
      >
        {done ? '✓' : ''}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium">
          {title}
          <span className="sr-only">{done ? ` (${t('done')})` : ` (${t('not done yet')})`}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

/**
 * Everything needed to get data in through the extension: is it installed, which Canvas address, has anything been
 * captured, and a button that opens its visible Sync now window.
 * - variant "settings": a checklist, each step with its own control.
 * - variant "login": one Connect button that does the steps in order, and signs in as soon as data arrives.
 */
export function CanvasConnection({ variant }: { variant: 'login' | 'settings' }) {
  const setup = useExtensionSetup();
  const { enableExtension } = useAuth();
  // The login page is outside the course filter, so it may not exist here.
  const selected = useOptionalCourseFilter()?.selected ?? null;
  const { requestSync } = usePull();
  const [address, setAddress] = useState('');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);

  // Show the saved address unless the student is typing a different one.
  useEffect(() => {
    if (!dirty) setAddress(setup.canvasHost ?? '');
  }, [setup.canvasHost, dirty]);

  if (!setup.installed) return <InstallSteps />;

  const hasData = setup.recordCount > 0;

  async function save(): Promise<boolean> {
    setBusy(true);
    const result = await setup.saveAddress(address);
    setBusy(false);
    if (!result) {
      setMessage({ text: t('The extension did not answer. Reload this page and try again.'), error: true });
      return false;
    }
    if (!result.ok) {
      setMessage({ text: result.error, error: true });
      return false;
    }
    setDirty(false);
    setMessage({ text: result.host ? t('Saved. Courseline will only read {host}.', { host: result.host }) : t('Address cleared. Nothing is captured until you save one.'), error: false });
    return true;
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    // Only save an address that was typed. If the field is untouched, the saved address stays as it is: pressing
    // Connect before the extension had answered (so the field was still empty) must not wipe it.
    if (dirty || !setup.canvasHost) {
      if (!address.trim()) {
        setMessage({ text: t('Enter your Canvas address.'), error: true });
        return;
      }
      if (!(await save())) return;
    }
    enableExtension();
    // Nothing captured yet: load the essentials in the background, with the preview in this page. The click on
    // Connect was the confirmation. Signing in happens by itself when the data arrives.
    if (!hasData) {
      requestSync({ confirm: false, depth: 'essential', depthChoice: false });
      setWaiting(true);
    }
  }

  const addressField = (
    <div className="flex gap-2">
      <input
        className={input}
        value={address}
        onChange={(e) => {
          setAddress(e.target.value);
          setDirty(true);
          setMessage(null);
        }}
        placeholder="https://yourschool.instructure.com"
        aria-label={t('Your Canvas address')}
        autoComplete="off"
        spellCheck={false}
        inputMode="url"
      />
      {variant === 'settings' && (
        <button type="button" onClick={() => void save()} disabled={busy} className={secondary}>
          {t('Save address')}
        </button>
      )}
    </div>
  );
  const messageLine = message && (
    <p role={message.error ? 'alert' : 'status'} className={`text-xs ${message.error ? 'text-red-700 dark:text-red-300' : 'text-neutral-600 dark:text-neutral-300'}`}>
      {message.text}
    </p>
  );

  if (variant === 'login') {
    return (
      <form onSubmit={connect} className="space-y-3">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {t('The Courseline extension is installed. Enter your Canvas address and Courseline will load your courses from it. No access token is needed.')}
        </p>
        <label className="block text-sm font-medium">
          {t('Your Canvas address')}
          <div className="mt-1">{addressField}</div>
        </label>
        {messageLine}
        <button disabled={busy || !setup.loaded} className={`w-full ${primary}`}>
          {busy ? t('Checking…') : hasData ? t('Sign in with the extension') : t('Connect and load my courses')}
        </button>
        {(waiting || (hasData === false && setup.canvasHost)) && (
          <p role="status" className="text-xs text-neutral-600 dark:text-neutral-300">
            {t('Loading your Canvas data in the background. You will be signed in as soon as it arrives.')}
          </p>
        )}
      </form>
    );
  }

  const chosen = selected && selected.size > 0 ? selected.size : (setup.snapshot?.appPinned?.length ?? 0);
  return (
    <ol className="space-y-4">
      <Step done title={t('The Courseline extension is connected')} />
      <Step done={!!setup.canvasHost} title={t('Your Canvas address')}>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('The address you use to open Canvas, for example school.instructure.com. Courseline only reads this address.')}</p>
        {addressField}
        {messageLine}
      </Step>
      <Step done={hasData} title={t('Your Canvas data')}>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {hasData
            ? tn(setup.recordCount, '{n} response captured, last {when}.', '{n} responses captured, last {when}.', { when: setup.lastCapturedAt ? formatAgo(setup.lastCapturedAt) : '—' })
            : t('Nothing captured yet. Press Sync now, or open Canvas in another tab and use it for a moment.')}
        </p>
        <div>
          <button type="button" onClick={() => requestSync()} className={secondary}>
            {t('Sync now')}
          </button>
          <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
            {t('You confirm in this page. It loads your courses’ pages one at a time in background tabs, and you can stop it.')}
          </span>
        </div>
      </Step>
      <Step done={chosen > 0} title={t('The courses to sync')}>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {chosen > 0
            ? tn(chosen, '{n} course chosen.', '{n} courses chosen.')
            : t('None chosen yet, so the courses on your Canvas dashboard are used.')}{' '}
          <Link to="/settings?tab=courses" className="text-accent-700 underline dark:text-accent-300">
            {t('Choose your courses')}
          </Link>
        </p>
      </Step>
    </ol>
  );
}
