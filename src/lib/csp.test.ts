import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './csp';

describe('contentSecurityPolicy', () => {
  const prod = contentSecurityPolicy(false);
  const dev = contentSecurityPolicy(true);

  it('blocks plugins, base-URL changes and eval, and allows scripts only from here and the Monaco CDN', () => {
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).not.toContain("'unsafe-eval'");
    const script = prod.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(script).toContain("'self'");
    expect(script).toContain('https://cdn.jsdelivr.net');
    expect(script).not.toMatch(/ https:( |$)/);
  });

  it('only the dev policy talks to the dev server over a websocket', () => {
    expect(dev).toContain('ws://localhost:*');
    expect(prod).not.toContain('ws://');
  });
});
