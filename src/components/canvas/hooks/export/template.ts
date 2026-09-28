
export const getExportModalTemplate = () => `
<div class="export-overlay" data-export-overlay>
    <div class="export-window" role="dialog" aria-modal="true">
        <div class="export-header">
            <h1>Export Preview</h1>
            <button class="export-close" type="button" data-export-close>Close</button>
            <button class="export-download" id="downloadBtn" disabled>Download</button>

        </div>
        <div class="layout">
            <div class="preview">
                <div class="preview-viewport">
                    <canvas id="previewCanvas" class="preview-canvas"></canvas>
                </div>
                <div class="preview-meta" id="previewMeta">Capturing preview... Large Canvas might take longer</div>
                <div class="preview-meta">Zoom to fit before exporting for best results.</div>
            </div>
            <div class="panel">
                <div class="card">
                    <label for="filename">Filename</label>
                    <div class="row">
                        <input id="filename" type="text" placeholder="drawing-export" />
                        <select id="ext">
                            <option value="png">.png</option>
                            <option value="jpg">.jpg</option>
                            <option value="webp">.webp</option>
                        </select>
                    </div>
                </div>
                <div class="card">
                    <label>Size</label>
                    <input id="scale" type="range" min="0.5" max="3" step="0.1" value="1" />
                    <div class="row" style="justify-content: space-between;">
                        <span class="value" id="scaleValue">100%</span>
                        <span class="value" id="sizeValue">0 × 0 px</span>
                    </div>
                </div>
                <div class="card">
                    <label>Quality</label>
                    <input id="quality" type="range" min="0.5" max="1" step="0.02" value="0.92" />
                    <div class="row" style="justify-content: space-between;">
                        <span class="value" id="qualityValue">92%</span>
                        <span class="value" id="qualityHint">JPG/WebP only</span>
                    </div>
                </div>
                <div class="card">
                    <label for="trimEmpty">Trim empty space</label>
                    <div class="row" style="justify-content: space-between; align-items: center;">
                        <span class="value">Trim</span>
                        <input id="trimEmpty" type="checkbox" style="width: auto;" />
                    </div>
                    <div class="hint">Detects transparent areas and crops them out.</div>
                </div>
            </div>
        </div>
    </div>
</div>
`;
