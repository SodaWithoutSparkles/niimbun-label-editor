import React, { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../store/useStore';
import type { Notification } from '../../store/storeTypes';

const TYPE_STYLES: Record<string, { border: string; bg: string; text: string }> = {
    info: { border: 'border-blue-500/80', bg: 'bg-blue-900/80', text: 'text-white' },
    success: { border: 'border-emerald-500/80', bg: 'bg-emerald-900/80', text: 'text-white' },
    warning: { border: 'border-amber-500/80', bg: 'bg-amber-900/80', text: 'text-white' },
    error: { border: 'border-red-500/80', bg: 'bg-red-900/80', text: 'text-white' }
};

export const NotificationCenter: React.FC = () => {
    const notifications = useStore((state) => state.notifications);
    const removeNotification = useStore((state) => state.removeNotification);
    const timeoutsRef = useRef<Map<string, number>>(new Map());

    const ids = useMemo(() => new Set(notifications.map((n: Notification) => n.id)), [notifications]);

    useEffect(() => {
        notifications.forEach((n: Notification) => {
            if (timeoutsRef.current.has(n.id)) return;
            const timeout = n.timeout ?? (n.type === 'error' ? 8000 : 5000);
            const timerId = window.setTimeout(() => {
                removeNotification(n.id);
            }, timeout);
            timeoutsRef.current.set(n.id, timerId);
        });

        timeoutsRef.current.forEach((timerId, id) => {
            if (!ids.has(id)) {
                window.clearTimeout(timerId);
                timeoutsRef.current.delete(id);
            }
        });
    }, [notifications, ids, removeNotification]);

    if (notifications.length === 0) return null;

    return (
        <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 max-w-sm w-[min(90vw,420px)]">
            {notifications.map((n: Notification) => {
                const style = TYPE_STYLES[n.type] ?? TYPE_STYLES.info;
                return (
                    <div
                        key={n.id}
                        className={`border ${style.border} ${style.bg} ${style.text} rounded-lg shadow-lg px-4 py-3 backdrop-blur`}
                        role="status"
                        aria-live="polite"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                                {n.title && (
                                    <div className="font-semibold text-sm mb-1">
                                        {n.title}
                                    </div>
                                )}
                                <div className="text-sm leading-snug">
                                    {n.message}
                                </div>
                                {n.detail && (
                                    <div className="mt-1 text-xs text-white/90 break-words">
                                        {n.detail}
                                    </div>
                                )}
                            </div>
                            <button
                                className="text-white/80 hover:text-white text-sm"
                                onClick={() => removeNotification(n.id)}
                                aria-label="Dismiss notification"
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
