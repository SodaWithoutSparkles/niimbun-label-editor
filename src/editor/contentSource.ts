import type { ContentSource, Node } from '../core/doc/types';

/**
 * The `ContentSource` a node carries, if any. Only text / qr / barcode nodes
 * hold one — text in `text`, qr/barcode in `data`. Shared by the Object tab,
 * the MFP panel, Js tab and the sample-row pre-pass so the carrier test cannot
 * drift between them (P6 W6).
 */
export const contentSourceOf = (node: Node): ContentSource | undefined => {
    if (node.type === 'text') return node.text;
    if (node.type === 'qr' || node.type === 'barcode' || node.type === 'code') return node.data;
    return undefined;
};

/** The node prop key that carries the source for a text / qr / barcode node. */
export const contentFieldKey = (node: Node): 'text' | 'data' | undefined => {
    if (node.type === 'text') return 'text';
    if (node.type === 'qr' || node.type === 'barcode' || node.type === 'code') return 'data';
    return undefined;
};

/** True when the node can carry a `ContentSource` (text / qr / barcode). */
export const carriesContentSource = (node: Node): boolean => contentSourceOf(node) !== undefined;
