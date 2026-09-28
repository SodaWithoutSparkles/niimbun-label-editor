import type { StoreSlice } from '../storeTypes';

export const createNotificationsSlice: StoreSlice = (set) => ({
    notifications: [],
    addNotification: (notification) => {
        const id = notification.id ?? Math.random().toString(36).slice(2, 10);
        set((state) => ({
            notifications: [...state.notifications, { ...notification, id }]
        }));
        return id;
    },
    removeNotification: (id) => set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id)
    })),
    clearNotifications: () => set({ notifications: [] })
});
