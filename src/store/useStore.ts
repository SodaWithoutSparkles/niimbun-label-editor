import { create } from 'zustand';
import type { AppState } from './storeTypes';
import { createCanvasSlice } from './slices/canvasSlice';
import { createColorsSlice } from './slices/colorsSlice';
import { createNotificationsSlice } from './slices/notificationsSlice';
import { createPreferencesSlice } from './slices/preferencesSlice';
import { createProjectSlice } from './slices/projectSlice';
import { createToolsSlice } from './slices/toolsSlice';
import { createNavigationSlice } from './slices/navigationSlice';

export const useStore = create<AppState>((set, get, store) => ({
    ...createProjectSlice(set, get, store),
    ...createCanvasSlice(set, get, store),
    ...createToolsSlice(set, get, store),
    ...createColorsSlice(set, get, store),
    ...createNotificationsSlice(set, get, store),
    ...createPreferencesSlice(set, get, store),
    ...createNavigationSlice(set, get, store),
} as AppState));
