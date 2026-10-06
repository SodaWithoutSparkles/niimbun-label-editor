if (typeof document !== 'undefined') {
    await import('@testing-library/jest-dom/vitest');
}
import { afterEach } from 'vitest';

// The store persists preferences in localStorage; keep tests isolated.
afterEach(() => {
    try {
        localStorage.clear();
    } catch {
        // ignore environments without storage
    }
});
