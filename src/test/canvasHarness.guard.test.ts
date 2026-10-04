import { describe, expect, it } from 'vitest';

/**
 * Guard: the real-canvas shim (`src/test/canvasHarness.ts`) and its
 * `@napi-rs/canvas` backing are TEST-ONLY. Product bundles must never pull in a
 * native rasterizer (action-plan §W0: "the harness is test-only; it must never
 * be imported by product code").
 *
 * Raw-source scan mirroring `src/core/headless.test.ts`: read every module under
 * `src/` as text and assert no non-test, non-test-support module imports either
 * module. Test files and `src/test/` itself are exempt (the harness lives there
 * and legitimately imports `@napi-rs/canvas`).
 */
const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

const isTestFile = (file: string): boolean => /\.test\.tsx?$/.test(file);
const isTestSupport = (file: string): boolean => /^\/?src\/test\//.test(file);
const productSources = Object.entries(sources).filter(
    ([file]) => !isTestFile(file) && !isTestSupport(file),
);

/**
 * True for a static `import`/`export … from 'x'`, a bare `import 'x'`, a dynamic
 * `import('x')`, or `require('x')` where the specifier contains `moduleName`.
 * Matching the specifier (not a bare word) keeps prose/comments from flagging.
 */
const importsModule = (code: string, moduleName: RegExp): boolean => {
    const specifier = `['"][^'"]*${moduleName.source}[^'"]*['"]`;
    return (
        new RegExp(`(?:from\\s+|import\\s*)${specifier}`).test(code) ||
        new RegExp(`(?:import|require)\\s*\\(\\s*${specifier}`).test(code)
    );
};

describe('test canvas harness is never imported by product code', () => {
    it('sees product sources (guards against a broken glob)', () => {
        expect(productSources.length).toBeGreaterThanOrEqual(2);
    });

    it('flags real offenders but not prose (guards against a broken regex)', () => {
        expect(
            importsModule('import { installCanvasShim } from "../test/canvasHarness";', /canvasHarness/),
        ).toBe(true);
        expect(
            importsModule("import { createCanvas } from '@napi-rs/canvas';", /@napi-rs\/canvas/),
        ).toBe(true);
        // A comment mentioning the module is not an import.
        expect(
            importsModule('// never import @napi-rs/canvas from product code', /@napi-rs\/canvas/),
        ).toBe(false);
    });

    it('no product module imports the test canvas harness', () => {
        const offenders = productSources
            .filter(([, code]) => importsModule(code, /canvasHarness/))
            .map(([file]) => file);
        expect(offenders).toEqual([]);
    });

    it('no product module imports @napi-rs/canvas', () => {
        const offenders = productSources
            .filter(([, code]) => importsModule(code, /@napi-rs\/canvas/))
            .map(([file]) => file);
        expect(offenders).toEqual([]);
    });
});
