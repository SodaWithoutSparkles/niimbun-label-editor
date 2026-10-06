// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { Node } from '../../core/doc/types';
import { SampleRowContext } from './sampleRowContext';
import type { SampleRowState } from './useSampleRow';
import { MfpPanel } from './MfpPanel';

/** MfpPanel (P6 W6): tab set and mount of Data source / Global data / JS. */

const textNode = (): Node => ({
    id: 't1',
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'static', value: 'hi' },
});

const imageNode = (): Node => ({
    id: 'i1',
    parentId: null,
    type: 'image',
    imageId: '',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
});

const doc = (nodes: Node[]) => createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes });

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, selectedNodeIds: [], csvRepo: null, trustRepo: null, docPast: [] });
});

const tab = (name: string) => screen.getByRole('tab', { name });

describe('MfpPanel — tab set', () => {
    it('always shows Object, Data source and Global data', () => {
        useStore.setState({ currentDoc: doc([]), selectedNodeIds: [] });
        render(<MfpPanel />);

        expect(tab('Object')).toBeTruthy();
        expect(tab('Data source')).toBeTruthy();
        expect(tab('Global data')).toBeTruthy();
        expect(screen.queryByRole('tab', { name: 'JS' })).toBeNull();
    });

    it('shows the JS tab for a selection that can carry a content source', () => {
        const selected = textNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t1'] });
        render(<MfpPanel />);
        expect(tab('JS')).toBeTruthy();
    });

    it('hides the JS tab for an image selection', () => {
        const selected = imageNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['i1'] });
        render(<MfpPanel />);
        expect(screen.queryByRole('tab', { name: 'JS' })).toBeNull();
    });
});

const templateNode = (): Node => ({
    id: 't1',
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'template', code: 'return 1', fallback: 'FB' },
});

const trustState = (trust: 'ask' | 'always' | 'never'): SampleRowState => ({
    overrides: new Map(),
    trust,
    blocked: trust === 'never',
    needsApproval: trust === 'ask',
    globalWarnings: [],
    templateErrors: new Map(),
    rowCount: 0,
    error: null,
});

describe('MfpPanel — JS tab trust', () => {
    it('shows the template-blocked reason when trust is never', () => {
        const selected = templateNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t1'] });
        render(
            <SampleRowContext.Provider value={trustState('never')}>
                <MfpPanel />
            </SampleRowContext.Provider>,
        );

        fireEvent.click(tab('JS'));
        expect(screen.getByTestId('js-template-blocked')).toBeTruthy();
    });

    it('shows the needs-approval reason when trust is ask', () => {
        const selected = templateNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t1'] });
        render(
            <SampleRowContext.Provider value={trustState('ask')}>
                <MfpPanel />
            </SampleRowContext.Provider>,
        );

        fireEvent.click(tab('JS'));
        expect(screen.getByTestId('js-template-needs-approval')).toBeTruthy();
    });
});
