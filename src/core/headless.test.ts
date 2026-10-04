import { describe, it, expect } from 'vitest';

// Read every source file in src/core as raw text at build time. Vite inlines
// the contents, so the test can scan them without touching the filesystem
// (the tsconfig has no node types).
const sources = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Product modules only: a test's own matchers/comments must not self-flag.
const productSources = Object.entries(sources).filter(
  ([file]) => !/\.test\.tsx?$/.test(file),
);

// Drop block and line comments so prose ("no React, Konva or DOM") can never
// match. A heuristic (it also trims `//` inside strings) — false negatives are
// acceptable for a purity guard; false positives are not.
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const offenders = (pattern: RegExp): string[] =>
  productSources.filter(([, code]) => pattern.test(stripComments(code))).map(([file]) => file);

describe('src/core is headless', () => {
  it('sees at least two core source files', () => {
    // Guards against a broken glob silently passing with zero files.
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(2);
  });

  it('imports nothing from react or react-dom', () => {
    expect(
      offenders(/(?:from\s+|import\s+)['"]react(-dom)?(\/[^'"]*)?['"]/),
    ).toEqual([]);
  });

  it('imports nothing from konva', () => {
    expect(offenders(/(?:from\s+|import\s+)['"]konva(\/[^'"]*)?['"]/)).toEqual([]);
  });

  it('references no DOM globals', () => {
    // `document.`/`document[` catches global usage without matching the domain
    // noun in strings ("document: must be an object"). ImageData /
    // HTMLCanvasElement are not domain vocabulary here, so a bare match is fine.
    expect(offenders(/\bdocument\s*[.[]|\bImageData\b|\bHTMLCanvasElement\b/)).toEqual([]);
  });
});
