import React, { createContext, useContext } from 'react';
import { useSampleRow, type SampleRowState } from './useSampleRow';

/**
 * Shares one sample-row resolve pass between the preview and the inspector
 * (P6 W6). The provider runs `useSampleRow` exactly once per editor mount; the
 * preview reads the evaluated **override map** and feeds it to its own
 * synchronous `resolve(doc, { overrides })`, while the JS tab reads the trust
 * decision and per-node template errors — without a second engine pass or a
 * second prompt. Keeping the pass async but the scene graph sync means live
 * geometry never waits on the engine.
 */
export const SampleRowContext = createContext<SampleRowState | null>(null);

export const SampleRowProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const state = useSampleRow();
    return <SampleRowContext.Provider value={state}>{children}</SampleRowContext.Provider>;
};

/** The shared state when a provider is mounted; otherwise `null`. */
export const useSampleRowState = (): SampleRowState | null => useContext(SampleRowContext);
