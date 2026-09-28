export const createDefaultProjectName = () => {
    const now = new Date();
    const formatted = now.toISOString().replace('T', ' ').slice(0, 16);
    return `untitled ${formatted}`;
};
