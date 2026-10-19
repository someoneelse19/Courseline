import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';

const input =
  'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950';

/** Sign in with a Canvas access token. Used on the login page and in Settings → Connection. */
export function TokenForm() {
  const { login, status } = useAuth();
  const [baseUrl, setBaseUrl] = useState(import.meta.env.VITE_CANVAS_BASE_URL ?? '');
  const [token, setToken] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login(baseUrl, token);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm font-medium">
        {t('Canvas URL')}
        <input className={input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://yourschool.instructure.com" required />
      </label>

      <label className="block text-sm font-medium">
        {t('Access token')}
        <input className={input} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
        <span className="mt-1 block text-xs font-normal text-neutral-500 dark:text-neutral-400">
          {t('Canvas → Account → Settings → “+ New Access Token”. See the README.')}
        </span>
      </label>

      <button
        disabled={status === 'loading'}
        className="w-full rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-60"
      >
        {status === 'loading' ? t('Checking…') : t('Sign in')}
      </button>

      <p className="text-xs text-amber-700 dark:text-amber-400">
        {t('⚠️ The token is saved in this browser’s localStorage. Only use this on a device you trust, and revoke it in Canvas when done.')}
      </p>
    </form>
  );
}
