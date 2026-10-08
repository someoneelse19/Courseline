import { useAuth } from '../context/AuthContext';

export function Header({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900">
      <button onClick={onMenu} className="rounded-md p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 md:hidden" aria-label="Toggle menu">
        ☰
      </button>
      <span className="text-lg font-bold">Courseline</span>
      <div className="flex-1" />
      <span className="hidden text-sm text-neutral-600 dark:text-neutral-300 sm:inline">{user?.short_name ?? user?.name}</span>
      <button onClick={logout} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
        Log out
      </button>
    </header>
  );
}
