import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TemplateContext } from './engine';

/**
 * Contract test for the documented template surface (P6 D6).
 *
 * `TemplateContext` is erased at runtime, so this test pins it two ways:
 *
 *  1. **Compile time** — `DOCUMENTED_MEMBERS` satisfies `keyof TemplateContext`
 *     (a rename/removal fails `tsc`), and the `REQUIRED_MEMBERS` literal is
 *     proven equal to `RequiredKeys<TemplateContext>` and a subset of
 *     `DOCUMENTED_MEMBERS`. Adding a required member without documenting it, or
 *     documenting a name that is not a key, fails the build.
 *  2. **Runtime** — every documented member name must appear in the developer
 *     guide text, and both docs must keep the extract-grammar tokens, so prose
 *     cannot drift from the type silently.
 *
 * Dependency-light: `node:fs` only, no canvas/DOM shim.
 */

/**
 * Every `TemplateContext` member the developer guide documents. This is the
 * single source of truth; `satisfies readonly (keyof TemplateContext)[]` fails
 * `tsc` if the type changes shape under it.
 */
const DOCUMENTED_MEMBERS = [
    'index',
    'total',
    'row',
    'rowCount',
    'now',
    'label',
    'globals',
    'fmt',
    'seeds',
] as const satisfies readonly (keyof TemplateContext)[];

/**
 * The members that are **required** on `TemplateContext` (no `?`). Kept as a
 * literal because a TypeScript type has no runtime keys. Two compile-time guards
 * below keep it honest: it must be exactly `RequiredKeys<TemplateContext>`, and
 * it must be covered by `DOCUMENTED_MEMBERS`.
 */
const REQUIRED_MEMBERS = [
    'index',
    'total',
    'row',
    'rowCount',
    'now',
    'label',
    'globals',
    'seeds',
] as const;

/** Keys of `T` that are not optional. */
type RequiredKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T];

/** Exact type equality via a generic-function identity check. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Constraint assertion: `Assert<false>` is a type error. */
type Assert<T extends true> = T;

// Compile-time guard: REQUIRED_MEMBERS is exactly the set of required members.
export type _RequiredMembersPinned = Assert<
    Equal<RequiredKeys<TemplateContext>, (typeof REQUIRED_MEMBERS)[number]>
>;

// Compile-time guard: every required member is in DOCUMENTED_MEMBERS.
const requiredIsDocumented: readonly (typeof DOCUMENTED_MEMBERS)[number][] = REQUIRED_MEMBERS;

const developerDoc = readFileSync(
    new URL('../../docs/developer-guide/template-context.md', import.meta.url),
    'utf8',
);
const userDoc = readFileSync(
    new URL('../../docs/user-guide/templates.md', import.meta.url),
    'utf8',
);

const tokens = (text: string, name: string): boolean => new RegExp(`\\b${name}\\b`).test(text);

describe('template contract docs', () => {
    it('covers every documented member in the developer guide text', () => {
        for (const member of DOCUMENTED_MEMBERS) {
            expect(developerDoc, `developer guide must document ctx.${member}`).toMatch(
                new RegExp(`\\b${member}\\b`),
            );
        }
    });

    it('keeps REQUIRED_MEMBERS fully documented', () => {
        // Runtime mirror of the compile-time subset guard above.
        expect(requiredIsDocumented).toEqual([...REQUIRED_MEMBERS]);
        for (const member of REQUIRED_MEMBERS) {
            expect(DOCUMENTED_MEMBERS).toContain(member);
        }
    });

    it('documents the seeds.docSeed pair', () => {
        expect(tokens(developerDoc, 'seeds')).toBe(true);
        expect(tokens(developerDoc, 'docSeed')).toBe(true);
        expect(tokens(userDoc, 'docSeed')).toBe(true);
    });

    it('keeps the extract-grammar tokens in both guides', () => {
        for (const token of ['a.b.0.c', '|fallback', '.rate']) {
            expect(userDoc, `user guide must mention ${token}`).toContain(token);
            expect(developerDoc, `developer guide must mention ${token}`).toContain(token);
        }
    });
});
