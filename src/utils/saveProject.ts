import type { SaveFile } from '../types';
import { compress, decompress } from './compress';
import { createDefaultProjectName } from './projectName';

export const sanitizeFilename = (name: string) => {
    const cleaned = name.replace(/[\\/:*?"<>|]+/g, '').trim();
    return cleaned || 'project';
};

export const ensureSaveExtension = (name: string) => {
    if (name.toLowerCase().endsWith('.fsp') || name.toLowerCase().endsWith('.json')) {
        return name;
    }
    return `${name}.fsp`;
};

export const shouldSaveAsJson = (name?: string | null) => {
    return !!name && name.toLowerCase().endsWith('.json');
};

export const buildDefaultSaveName = (projectName?: string) => {
    return ensureSaveExtension(sanitizeFilename((projectName && projectName.length > 0) ? projectName : createDefaultProjectName()));
};

export const parseTimestamp = (timestamp?: SaveFile['timestamp']) => {
    if (!timestamp) return null;
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const time = date.getTime();
    return Number.isNaN(time) ? null : time;
};

export const parseSaveFile = async (file: File): Promise<SaveFile> => {
    const buffer = await file.arrayBuffer();
    try {
        const text = new TextDecoder().decode(new Uint8Array(buffer));
        return JSON.parse(text) as SaveFile;
    } catch (err) {
        const decompressed = await decompress(buffer);
        return JSON.parse(decompressed) as SaveFile;
    }
};

export const buildSaveBlob = async (saveFile: SaveFile, asJson: boolean) => {
    const json = JSON.stringify(saveFile, null, 2);
    if (asJson) {
        return new Blob([json], { type: 'application/json' });
    }
    const compressed = await compress(json);
    return new Blob([compressed], { type: 'application/gzip' });
};

export const writeSaveFileToHandle = async (handle: FileSystemFileHandle, saveFile: SaveFile) => {
    const writable = await handle.createWritable();
    const blob = await buildSaveBlob(saveFile, shouldSaveAsJson(handle.name));
    await writable.write(blob);
    await writable.close();
};

export const downloadSaveFile = async (filename: string, saveFile: SaveFile) => {
    const blob = await buildSaveBlob(saveFile, shouldSaveAsJson(filename));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
