import type { Guide, LabelDoc } from '../../core/doc/types';

export type { Guide } from '../../core/doc/types';

/**
 * Non-printable editor guides, persisted with the label (`label.guides`).
 *
 * The guide travels with the geometry: the paper type (preset) seeds it on
 * `createLabelDoc`, and `resolveGuides` is now a pure read. An absent field
 * (a document written before guides were persisted) reads as an empty list.
 */
export const resolveGuides = (doc: LabelDoc): Guide[] => doc.label.guides ?? [];
