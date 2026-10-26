/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { desktopCapturer, IpcMainInvokeEvent, NativeImage, screen } from "electron";

let cachedSources: { id: string; name: string; display_id: string; thumbnail: NativeImage }[] | null = null;
let sourcesPromise: Promise<{ id: string; name: string; display_id: string; thumbnail: NativeImage }[]> | null = null;
let lastDisplayFingerprint = "";
let initialized = false;
let cacheVersion = 0;

function invalidate() {
    cacheVersion++;
    cachedSources = null;
    lastDisplayFingerprint = "";
}

function initListeners() {
    if (initialized) return;
    try {
        if (!screen || typeof screen.on !== "function") return;
        initialized = true;
        screen.on("display-added", invalidate);
        screen.on("display-removed", invalidate);
        screen.on("display-metrics-changed", invalidate);
    } catch {
        // Safe fallback
    }
}

try {
    initListeners();
} catch {
    // Ignore
}

function getDisplayFingerprint(displays: Electron.Display[]) {
    return displays.map(d => `${d.id}:${d.bounds.x}:${d.bounds.y}:${d.bounds.width}:${d.bounds.height}:${d.scaleFactor ?? 1}`).join(";");
}

async function getSources() {
    const displays = screen.getAllDisplays().filter(d => d.bounds && d.bounds.width > 0 && d.bounds.height > 0);
    const fingerprint = getDisplayFingerprint(displays);
    if (cachedSources && fingerprint === lastDisplayFingerprint) {
        return cachedSources;
    }
    if (sourcesPromise) {
        return await sourcesPromise;
    }
    const currentVersion = cacheVersion;
    lastDisplayFingerprint = fingerprint;
    sourcesPromise = desktopCapturer.getSources({
        types: ["screen"],
        fetchWindowIcons: false,
        thumbnailSize: { width: 160, height: 160 }
    }).then(sources => {
        if (currentVersion === cacheVersion) {
            cachedSources = sources;
        }
        sourcesPromise = null;
        return sources;
    }).catch(() => {
        sourcesPromise = null;
        return [];
    });
    return await sourcesPromise;
}

export async function getActiveScreenSource(_: IpcMainInvokeEvent, invert = false) {
    try {
        initListeners();

        const displays = screen.getAllDisplays().filter(d => d.bounds && d.bounds.width > 0 && d.bounds.height > 0);
        if (displays.length <= 1) return null;

        const point = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(point);
        if (!display || !display.bounds || display.bounds.width <= 0 || display.bounds.height <= 0) return null;

        const sources = await getSources();
        if (sources.length <= 1) return null;

        const displayIdStr = display.id.toString();

        // 1. Direct display_id match
        let match = sources.find(s => Boolean(s.display_id) && s.display_id === displayIdStr);

        // 1b. Direct screen:<id>:0 match
        if (!match && display.id > 1000) {
            match = sources.find(s => s.id === `screen:${displayIdStr}:0` || s.id === `screen:${displayIdStr}`);
        }

        // 2. Aspect ratio signature matching
        if (!match && sources.length === displays.length) {
            const displayAspect = display.bounds.width / (display.bounds.height || 1);
            const displayAspects = displays.map(d => d.bounds.width / (d.bounds.height || 1));
            const isUniqueAspect = displayAspects.filter(a => Math.abs(a - displayAspect) < 0.08).length === 1;

            if (isUniqueAspect) {
                let bestDiff = Infinity;
                let bestSource: typeof sources[0] | null = null;
                for (const s of sources) {
                    const size = s.thumbnail?.getSize?.() ?? { width: 0, height: 0 };
                    if (size.width && size.height) {
                        const aspect = size.width / size.height;
                        const diff = Math.abs(aspect - displayAspect);
                        if (diff < bestDiff) {
                            bestDiff = diff;
                            bestSource = s;
                        }
                    }
                }
                if (bestDiff < 0.08 && bestSource) {
                    match = bestSource;
                }
            }
        }

        // 3. Primary vs Secondary & spatial index matching
        if (!match && sources.length >= 2) {
            const primaryDisplay = screen.getPrimaryDisplay();
            const isPrimary = display.id === primaryDisplay.id || (display.bounds.x === 0 && display.bounds.y === 0);

            if (isPrimary) {
                match = sources.find(s => s.id === "screen:0:0" || s.id === "screen:0") ??
                        sources.find(s => {
                            const m = s.name.match(/\b(\d+)\b/);
                            return m ? parseInt(m[1], 10) === 1 : false;
                        }) ?? sources[0];
            } else if (displays.length === 2 && sources.length === 2) {
                match = sources.find(s => s.id === "screen:1:0" || s.id === "screen:1") ??
                        sources.find(s => {
                            const m = s.name.match(/\b(\d+)\b/);
                            return m ? parseInt(m[1], 10) === 2 : false;
                        }) ?? sources[1];
            } else {
                const nonPrimaryDisplays = displays
                    .filter(d => d.id !== primaryDisplay.id && !(d.bounds.x === 0 && d.bounds.y === 0))
                    .sort((a, b) => (a.bounds.x !== b.bounds.x ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y));
                const nonPrimaryIdx = nonPrimaryDisplays.findIndex(d => d.id === display.id);
                const secondarySources = sources.filter(s => s.id !== "screen:0:0" && s.id !== "screen:0" && !s.name.match(/\b1\b/));
                if (nonPrimaryIdx >= 0 && nonPrimaryIdx < secondarySources.length) {
                    match = secondarySources[nonPrimaryIdx];
                }
            }
        }

        // 4. Fallback to first source
        if (!match) {
            match = sources[0];
        }

        // 5. User invert setting override
        if (invert && match && sources.length >= 2) {
            const currentMatchId = match.id;
            const idx = sources.findIndex(s => s.id === currentMatchId);
            if (idx !== -1) {
                match = sources[(idx + 1) % sources.length];
            } else {
                const other = sources.find(s => s.id !== currentMatchId);
                if (other) match = other;
            }
        }

        return {
            sourceId: match.id,
            sourceName: match.name,
            displayId: display.id
        };
    } catch {
        return null;
    }
}
