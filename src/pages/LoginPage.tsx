import { CanvasConnection } from '../components/CanvasConnection';
import { TokenForm } from '../components/TokenForm';
import { useAuth } from '../context/AuthContext';
import { extensionInstalled } from '../extension/bridge';
import { t } from '../i18n';

export function LoginPage() {
  const { error } = useAuth();
  const installed = extensionInstalled();

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-xs dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-2xl font-bold">Courseline</h1>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        {installed ? (
          <>
            <CanvasConnection variant="login" />
            <details className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
              <summary className="cursor-pointer text-sm font-medium">{t('Sign in with an access token instead')}</summary>
              <div className="mt-3">
                <TokenForm />
              </div>
            </details>
          </>
        ) : (
          <>
            <TokenForm />
            <details className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
              <summary className="cursor-pointer text-sm font-medium">{t('No access token? Use the browser extension')}</summary>
              <div className="mt-3">
                <CanvasConnection variant="login" />
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
