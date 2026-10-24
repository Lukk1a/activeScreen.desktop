/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exec } from "child_process";
import { desktopCapturer, IpcMainInvokeEvent, NativeImage, screen } from "electron";

interface WindowsScreenInfo {
    device: string;
    screenIndex: number;
    bounds: { x: number; y: number; width: number; height: number };
    isPrimary: boolean;
}

let cachedSources: { id: string; name: string; display_id: string; thumbnail: NativeImage }[] | null = null;
let sourcesPromise: Promise<{ id: string; name: string; display_id: string; thumbnail: NativeImage }[]> | null = null;
let lastDisplayFingerprint = "";
let initialized = false;
let cachedWindowsScreens: WindowsScreenInfo[] | null = null;
let isQueryingWindowsScreens = false;
let hasPendingWindowsQuery = false;
let cacheVersion = 0;

function queryWindowsScreens() {
    if (process.platform !== "win32") return;
    if (isQueryingWindowsScreens) {
        hasPendingWindowsQuery = true;
        return;
    }
    isQueryingWindowsScreens = true;
    const queryVersion = cacheVersion;

    const cmd = 'powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { `$_.DeviceName + \':\' + `$_.Bounds.X + \':\' + `$_.Bounds.Y + \':\' + `$_.Bounds.Width + \':\' + `$_.Bounds.Height + \':\' + `$_.Primary }"';

    exec(cmd, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
        isQueryingWindowsScreens = false;

        // If an invalidation occurred while this query was in flight, discard and re-query if requested
        if (queryVersion !== cacheVersion) {
            if (hasPendingWindowsQuery) {
                hasPendingWindowsQuery = false;
                queryWindowsScreens();
            }
            return;
        }

        if (hasPendingWindowsQuery) {
            hasPendingWindowsQuery = false;
            queryWindowsScreens();
        }

        if (err || !stdout) return;

        const screens: WindowsScreenInfo[] = [];
        const lines = stdout.trim().split(/\r?\n/);
        let screenIndex = 0;
        for (const line of lines) {
            const parts = line.trim().split(":");
            if (parts.length >= 6) {
                const device = parts[0];
                const bounds = {
                    x: parseInt(parts[1], 10),
                    y: parseInt(parts[2], 10),
                    width: parseInt(parts[3], 10),
                    height: parseInt(parts[4], 10)
                };
                const isPrimary = parts[5].toLowerCase() === "true";
                if (!isNaN(bounds.x) && !isNaN(bounds.y) && !isNaN(bounds.width) && bounds.width > 0 && !isNaN(bounds.height) && bounds.height > 0) {
                    screens.push({ device, screenIndex, bounds, isPrimary });
                    screenIndex++;
                }
            }
        }
        if (screens.length > 0 && queryVersion === cacheVersion) {
            cachedWindowsScreens = screens;
        }
    });
}

function invalidate() {
    cacheVersion++;
    cachedSources = null;
    cachedWindowsScreens = null;
    lastDisplayFingerprint = "";
    queryWindowsScreens();
}

function initListeners() {
    if (initialized) return;
    try {
        if (!screen || typeof screen.on !== "function") return;
        initialized = true;
        screen.on("display-added", invalidate);
        screen.on("display-removed", invalidate);
        screen.on("display-metrics-changed", invalidate);
        queryWindowsScreens();
    } catch {
        // Safe fallback if screen API is not yet available at load time
    }
}

// Proactively initialize screen queries on module load if screen is ready
try {
    initListeners();
} catch {
    // Handled in getActiveScreenSource
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

        // 1b. Direct screen:<id>:0 match (when display.id is an HMONITOR or hardware ID)
        if (!match && display.id > 1000) {
            match = sources.find(s => s.id === `screen:${displayIdStr}:0` || s.id === `screen:${displayIdStr}`);
        }

        // 2. Aspect ratio signature matching (instant thumbnail analysis, no external process)
        // Highly accurate for mixed orientation (1 portrait + 1 landscape), ultrawide + 16:9, etc.
        if (!match && sources.length === displays.length) {
            const displayAspect = display.bounds.width / (display.bounds.height || 1);
            const displayAspects = displays.map(d => d.bounds.width / (d.bounds.height || 1));
            const isUniqueAspect = displayAspects.filter(a => Math.abs(a - displayAspect) < 0.08).length === 1;

            if (isUniqueAspect) {
                let bestDiff = Infinity;
                let bestSource: typeof sources[0] | null = null;
                for (const s of sources) {
                    const size = s.thumbnail.getSize();
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

        // 3. Windows system screen geometry matching (System.Windows.Forms.Screen)
        // Robust topology matching for identical resolutions on 3+ monitors, stacked monitors, negative coordinates, mixed DPI
        if (!match && cachedWindowsScreens && cachedWindowsScreens.length === displays.length) {
            const primaryDisplay = screen.getPrimaryDisplay();
            const isDisplayPrimary = display.id === primaryDisplay.id ||
                (display.bounds.x === 0 && display.bounds.y === 0);

            let matchedWinScreen: WindowsScreenInfo | null = null;

            // 3a. Primary display matching
            if (isDisplayPrimary) {
                matchedWinScreen = cachedWindowsScreens.find(ws => ws.isPrimary) ?? null;
            }

            // 3b. Normalized topology & relative coordinate geometry matching
            if (!matchedWinScreen) {
                const primaryWs = cachedWindowsScreens.find(ws => ws.isPrimary) ?? cachedWindowsScreens[0];
                const primaryWidth = primaryDisplay.bounds.width || 1920;
                const primaryHeight = primaryDisplay.bounds.height || 1080;
                const wsPrimaryWidth = primaryWs.bounds.width || 1920;
                const wsPrimaryHeight = primaryWs.bounds.height || 1080;

                const normX = (display.bounds.x - primaryDisplay.bounds.x) / primaryWidth;
                const normY = (display.bounds.y - primaryDisplay.bounds.y) / primaryHeight;
                const displayAspect = display.bounds.width / (display.bounds.height || 1);

                let bestScore = Infinity;
                for (const ws of cachedWindowsScreens) {
                    if (ws.isPrimary && !isDisplayPrimary) continue;

                    const wsNormX = (ws.bounds.x - primaryWs.bounds.x) / wsPrimaryWidth;
                    const wsNormY = (ws.bounds.y - primaryWs.bounds.y) / wsPrimaryHeight;
                    const wsAspect = ws.bounds.width / (ws.bounds.height || 1);

                    const posDist = Math.hypot(normX - wsNormX, normY - wsNormY);
                    const aspectDiff = Math.abs(displayAspect - wsAspect);
                    const score = posDist + aspectDiff * 0.5;

                    if (score < bestScore) {
                        bestScore = score;
                        matchedWinScreen = ws;
                    }
                }
            }

            if (matchedWinScreen) {
                const targetIdx = matchedWinScreen.screenIndex;

                // Match by exact Chromium source index in sources array (AllScreens and EnumDisplayMonitors order)
                if (targetIdx >= 0 && targetIdx < sources.length) {
                    match = sources[targetIdx];
                }

                // Match by screen index in source id (e.g. "screen:0:0" for index 0)
                if (!match) {
                    const idxStr = targetIdx.toString();
                    match = sources.find(s => s.id === `screen:${idxStr}:0` || s.id === `screen:${idxStr}`);
                }

                // Match by 1-based screen number in source name (e.g. "Screen 1" for index 0)
                if (!match) {
                    const numStr = (targetIdx + 1).toString();
                    match = sources.find(s => {
                        const m = s.name.match(/\b(\d+)\b/) ?? s.name.match(/(\d+)/);
                        return m ? m[1] === numStr : false;
                    });
                }
            }
        }

        // 4. Primary vs Secondary & spatial index matching fallback
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
                // Non-primary displays sorted spatially, mapped to secondary sources (sources[1], sources[2], ...)
                const nonPrimaryDisplays = displays
                    .filter(d => d.id !== primaryDisplay.id && !(d.bounds.x === 0 && d.bounds.y === 0))
                    .sort((a, b) => (a.bounds.x !== b.bounds.x ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y));
                const secondarySources = sources.slice(1);

                const nonPrimaryIdx = nonPrimaryDisplays.findIndex(d => d.id === display.id);
                if (nonPrimaryIdx !== -1 && secondarySources[nonPrimaryIdx]) {
                    match = secondarySources[nonPrimaryIdx];
                }
            }
        }

        // 5. Fallback to first source
        if (!match) {
            match = sources[0];
        }

        // 6. User invert setting override
        if (invert && match && sources.length >= 2) {
            const currentMatchId = match.id;
            const idx = sources.findIndex(s => s.id === currentMatchId);
            if (idx !== -1) {
                match = sources[sources.length - 1 - idx];
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
