import { createTrustGate, type TrustGate } from '../core/trust';
import type { TrustRepo } from '../data/trustRepo';

/**
 * Shared trust-gate cache (P6 W6 fix).
 *
 * One `TrustGate` — and therefore one **session overlay** — per `TrustRepo`
 * instance. Both the editor's sample-row pass and Settings' trust section must
 * resolve/persist through this one gate: otherwise a Settings "Revoke" (which
 * only touches the repo) would not lift a session Allow held in a second,
 * editor-private overlay.
 *
 * Lives outside the components so the store can create the gate at boot without
 * importing a component (which would invert the dependency direction and risk an
 * eval-time cycle). The cache is keyed by repo identity (a `WeakMap`), so passing
 * the same repo always yields the same gate; a `null` repo yields `null`.
 */

const gateByRepo = new WeakMap<TrustRepo, TrustGate>();

/** The session gate for a repo, or `null` when no repo is available. */
export const trustGateFor = (repo: TrustRepo | null): TrustGate | null => {
    if (!repo) return null;
    const existing = gateByRepo.get(repo);
    if (existing) return existing;
    const gate = createTrustGate({ repo });
    gateByRepo.set(repo, gate);
    return gate;
};
