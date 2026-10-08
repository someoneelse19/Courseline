import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { login, error, status } = useAuth();
  const [baseUrl, setBaseUrl] = useState(import.meta.env.VITE_CANVAS_BASE_URL ?? '');
  const [token, setToken] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login(baseUrl, token);
  };

  const input =
    'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950';

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-xs dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-2xl font-bold">Courseline</h1>

        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>
        )}

        <label className="block text-sm font-medium">
          Canvas URL
          <input className={input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://yourschool.instructure.com" required />
        </label>

        <label className="block text-sm font-medium">
          Access token
          <input className={input} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
          <span className="mt-1 block text-xs font-normal text-neutral-500 dark:text-neutral-400">
            Canvas → Account → Settings → “+ New Access Token”. See the README.
          </span>
        </label>

        <button
          disabled={status === 'loading'}
          className="w-full rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-60"
        >
          {status === 'loading' ? 'Checking…' : 'Sign in'}
        </button>

        <p className="text-xs text-amber-700 dark:text-amber-400">
          ⚠️ The token is saved in this browser’s localStorage. Only use this on a device you trust, and revoke it in Canvas when done.
        </p>
      </form>
    </div>
  );
}
