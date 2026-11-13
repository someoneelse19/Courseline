// Signing in to Microsoft (the student's school account), for what Canvas does not give students: people's emails and
// ids from the school's directory, and files in OneDrive. MSAL (@azure/msal-browser) does the sign-in in a popup; the
// popup comes back to this app's own address, where main.tsx hands the answer to the window that opened it. Tokens are
// kept for this browser tab only (sessionStorage). Read-only Microsoft Graph permissions, each asked for when first
// needed. Configured by VITE_MS_CLIENT_ID (the app registration) and VITE_MS_TENANT_ID (the school's directory).
import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';

const CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID;
const TENANT = import.meta.env.VITE_MS_TENANT_ID || 'organizations';
const GRAPH = 'https://graph.microsoft.com/v1.0';

export const microsoftConfigured = !!CLIENT_ID;

/** Is this page load a sign-in popup coming back with Microsoft's answer? (See main.tsx.) */
export function isMicrosoftAuthResponse(): boolean {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, '') || window.location.search);
  return params.has('state') && (params.has('code') || params.has('error')) && !!window.opener;
}

let app: Promise<IPublicClientApplication> | null = null;
function client(): Promise<IPublicClientApplication> {
  if (!CLIENT_ID) return Promise.reject(new Error('Microsoft sign-in is not set up (VITE_MS_CLIENT_ID in .env).'));
  return (app ??= import('@azure/msal-browser').then(({ createStandardPublicClientApplication }) =>
    createStandardPublicClientApplication({
      auth: { clientId: CLIENT_ID, authority: `https://login.microsoftonline.com/${TENANT}`, redirectUri: `${window.location.origin}/` },
      cache: { cacheLocation: 'sessionStorage' },
    }),
  ));
}

/** The signed-in Microsoft account, if any (this tab). */
export async function microsoftAccount(): Promise<AccountInfo | null> {
  const msal = await client();
  return msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
}

/** Signs in (a popup; reuses a Microsoft session the browser already has, so usually just picking the account). */
export async function signInMicrosoft(): Promise<AccountInfo> {
  const msal = await client();
  const result = await msal.loginPopup({ scopes: ['User.Read'], prompt: 'select_account' });
  msal.setActiveAccount(result.account);
  return result.account;
}

export async function signOutMicrosoft(): Promise<void> {
  const msal = await client();
  const account = await microsoftAccount();
  // Forgets the account in this app only; the student stays signed in to Microsoft itself.
  if (account) await msal.clearCache({ account });
}

/** A token for these Graph permissions: from the cache, else a popup (where the student consents the first time). */
async function tokenFor(scopes: string[]): Promise<string> {
  const msal = await client();
  const account = await microsoftAccount();
  if (!account) throw new Error('Not signed in to Microsoft.');
  try {
    return (await msal.acquireTokenSilent({ scopes, account })).accessToken;
  } catch {
    return (await msal.acquireTokenPopup({ scopes, account })).accessToken;
  }
}

/** GET from Microsoft Graph with the given permissions. */
export async function graphGet<T>(path: string, scopes: string[], headers: Record<string, string> = {}): Promise<T> {
  const token = await tokenFor(scopes);
  const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}`, ...headers } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new Error(`Microsoft answered ${res.status}${body?.error?.code ? ` (${body.error.code})` : ''}${body?.error?.message ? `: ${body.error.message}` : ''}`);
  }
  return (await res.json()) as T;
}
