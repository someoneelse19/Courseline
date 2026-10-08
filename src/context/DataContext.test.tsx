import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery, type QueryResult } from '../hooks/useQuery';
import { DataProvider } from './DataContext';

// useQuery + DataProvider are the cache every screen relies on. These tests render a tiny probe
// component and watch how many times the fetcher runs and what the hook reports.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot>;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const latest: { current?: QueryResult<string> } = {};
function Probe({ id, fetcher }: { id: string; fetcher: () => Promise<string> }) {
  latest.current = useQuery(`k:${id}`, fetcher);
  return null;
}
const mount = async (ui: React.ReactElement) => {
  await act(async () => root.render(<DataProvider>{ui}</DataProvider>));
};

describe('useQuery + DataProvider', () => {
  it('loads once and reports data', async () => {
    const fetcher = vi.fn().mockResolvedValue('hello');
    await mount(<Probe id="a" fetcher={fetcher} />);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(latest.current).toMatchObject({ data: 'hello', loading: false, error: undefined });
  });

  it('shares one request between components that use the same key', async () => {
    const fetcher = vi.fn().mockResolvedValue('shared');
    await mount(
      <>
        <Probe id="same" fetcher={fetcher} />
        <Probe id="same" fetcher={fetcher} />
      </>,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps different keys separate', async () => {
    const fetcher = vi.fn().mockImplementation(async () => 'x');
    await mount(
      <>
        <Probe id="one" fetcher={fetcher} />
        <Probe id="two" fetcher={fetcher} />
      </>,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('captures a failure as `error` instead of throwing, and refetch recovers', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    await mount(<Probe id="e" fetcher={fetcher} />);
    expect(latest.current?.error?.message).toBe('boom');
    expect(latest.current?.data).toBeUndefined();
    await act(async () => latest.current?.refetch());
    expect(latest.current).toMatchObject({ data: 'ok', error: undefined });
  });

  it('does not refetch fresh data on remount, but does after 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetcher = vi.fn().mockResolvedValue('v');
    await mount(<Probe id="s" fetcher={fetcher} />);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Same provider stays mounted; remount only the consumer by swapping a sibling key back.
    await mount(<Probe id="other" fetcher={fetcher} />);
    await mount(<Probe id="s" fetcher={fetcher} />);
    expect(fetcher).toHaveBeenCalledTimes(2); // 's' (1) + 'other' (1): 's' was still fresh

    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);
    await mount(<Probe id="other" fetcher={fetcher} />);
    await mount(<Probe id="s" fetcher={fetcher} />);
    expect(fetcher.mock.calls.length).toBeGreaterThan(2); // stale data is refetched
  });

  it('keeps showing the old data while a refetch is in flight', async () => {
    let release: (v: string) => void = () => {};
    const fetcher = vi.fn().mockResolvedValueOnce('first').mockImplementationOnce(() => new Promise<string>((r) => (release = r)));
    await mount(<Probe id="r" fetcher={fetcher} />);
    await act(async () => latest.current?.refetch());
    expect(latest.current).toMatchObject({ data: 'first', loading: true });
    await act(async () => release('second'));
    expect(latest.current).toMatchObject({ data: 'second', loading: false });
  });
});
