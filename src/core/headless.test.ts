import { describe, it, expect } from 'vitest';

// Read every source file in src/core as raw text at build time. Vite inlines
// the contents, so the test can scan them without touching the filesystem
// (the tsconfig has no node types).
const sources = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('src/core is headless', () => {
  it('sees at least two core source files', () => {
    // Guards against a broken glob silently passing with zero files.
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(2);
  });

  it('imports nothing from react or react-dom', () => {
    const offenders = Object.entries(sources)
      .filter(([, code]) => /(?:from\s+|import\s+)['"]react(-dom)?(\/[^'"]*)?['"]/.test(code))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
