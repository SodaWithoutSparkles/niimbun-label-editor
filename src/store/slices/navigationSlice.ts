import type { StoreSlice } from '../storeTypes';

export const createNavigationSlice: StoreSlice = (set) => ({
    canvasPosition: { x: 0, y: 0, scale: 1 },
    setCanvasPosition: (pos) => set({ canvasPosition: pos }),
    homeViewTrigger: 0,
    triggerHomeView: () => set((state) => ({ homeViewTrigger: state.homeViewTrigger + 1 })),
});
