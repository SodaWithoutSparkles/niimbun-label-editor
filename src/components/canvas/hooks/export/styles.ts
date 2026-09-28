
export const getExportModalStyles = () => `
    * { box-sizing: border-box; }
    .export-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.72); display: flex; align-items: center; justify-content: center; z-index: 9999; }
    .export-window { width: min(1200px, 94vw); height: min(800px, 94vh); background: #0f172a; color: #e2e8f0; border-radius: 16px; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.45); display: flex; flex-direction: column; overflow: hidden; border: 1px solid #1f2937; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; }
    .export-header { padding: 14px 18px; display: flex; align-items: center; justify-content: flex-start; gap: 8px; background: #111827; border-bottom: 1px solid #1f2937; }
    .export-header h1 { margin: 0; font-size: 16px; font-weight: 700; margin-right: auto; }
    .export-close { border: none; background: #ef4444; color: #ffffff; font-size: 14px; cursor: pointer; padding: 6px 10px; border-radius: 8px; display: inline-flex; align-items: center; gap: 8px; margin-left: 8px; }
    .export-close:hover { filter: brightness(0.95); }
    .export-download { border: none; background: #38bdf8; color: #0f172a; font-size: 14px; cursor: pointer; padding: 6px 10px; border-radius: 8px; display: inline-flex; align-items: center; gap: 8px; margin-left: 8px; }
    .export-download:hover { filter: brightness(0.95); }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; height: 100%; }
    .preview { padding: 24px; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
    .preview-viewport { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 12px; border: 1px solid #1f2937; background: #0f172a; --preview-scale: 1; }
    .preview-viewport .preview-canvas { display: block; transform: scale(var(--preview-scale)); transform-origin: center; background: #0f172a; border-radius: 12px; border: 1px solid #1f2937; }
    .panel { padding: 24px; background: #111827; border-left: 1px solid #1f2937; display: flex; flex-direction: column; gap: 16px; }
    .card { background: #0b1220; border: 1px solid #1f2937; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; }
    .row { display: flex; gap: 8px; align-items: center; }
    input, select { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; font-size: 14px; }
    input[type=range] { width: 100%; }
    .value { font-size: 12px; color: #cbd5f5; }
    .hint { font-size: 11px; color: #94a3b8; }
    .button { padding: 10px 14px; border-radius: 10px; border: none; background: #38bdf8; color: #0f172a; font-weight: 700; cursor: pointer; }
    .button:disabled { opacity: 0.5; cursor: not-allowed; }
    .export-window canvas { max-width: none; max-height: none; }
    .preview-meta { margin-top: 10px; font-size: 12px; color: #94a3b8; }
    @media (max-width: 1024px) {
        .layout { grid-template-columns: 1fr; }
        .panel { border-left: none; border-top: 1px solid #1f2937; }
    }
`;
