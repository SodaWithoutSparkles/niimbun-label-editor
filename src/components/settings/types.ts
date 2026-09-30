import type { ReactNode } from 'react';

/** One tab inside a settings section. */
export interface SettingsTab {
    id: string;
    label: string;
    content: ReactNode;
}

/** One sidebar entry. Sections without tabs render `content` directly. */
export interface SettingsSection {
    id: string;
    label: string;
    icon: ReactNode;
    content?: ReactNode;
    tabs?: SettingsTab[];
}
