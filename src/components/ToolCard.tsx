import type { ReactNode } from 'react';
import { useCanvasTab } from '../hooks/useCanvasTab';
import { t } from '../i18n';
import { UiIcon, type UiIconName } from './icons';
import { TabBlocked } from './ui';

// A quiz or an external tool drawn like a file card (components/Attachments.tsx): a kind icon, the name and a detail
// line, opening in a new tab (lib/canvasTab.ts) since Canvas will not let it be shown inside Courseline.

export function ToolCard({ url, name, icon, detail, aside }: { url: string; name: string; icon: UiIconName; detail?: string; aside?: ReactNode }) {
  const { open, blocked } = useCanvasTab();
  return (
    <div>
      <button
        type="button"
        onClick={() => open(url)}
        title={t('Opens in a new tab')}
        className="flex w-full min-w-[12rem] items-center gap-2.5 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-left hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        <span className="text-accent-600 dark:text-accent-400">
          <UiIcon name={icon} className="h-6 w-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{name}</span>
          <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">{detail ?? t('Opens in a new tab')}</span>
        </span>
        {aside}
        <span className="text-neutral-400">
          <UiIcon name="newWindow" />
        </span>
      </button>
      {blocked && <div className="mt-2"><TabBlocked /></div>}
    </div>
  );
}
