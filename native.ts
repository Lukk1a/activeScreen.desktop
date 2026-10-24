/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exec } from "child_process";
import { desktopCapturer, IpcMainInvokeEvent, NativeImage, screen } from "electron";

interface WindowsScreenInfo {
    device: string;
    screenNumber: number;
    bounds: { x: number; y: number; width: number; height: number };
    isPrimary: boolean;
}

let cachedSources: { id: string; name: string; display_id: string; thumbnail: NativeImage }[] | null = null;
let sourcesPromise: Promise<{ id: string; name: string; display_id: string; thumbnail: NativeImage }[]> | null = null;
let lastDisplayCount = 0;
let initialized = false;
let cachedWindowsScreens: WindowsScreenInfo[] | null = null;
let isQueryingWindowsScreens = false;

function queryWindowsScreens() {
    if (process.platform !== "win32" || isQueryingWindowsScreens) return;
    isQueryingWindowsScreens = true;

    const cmd = 'powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.DeviceName + \':\' + $_.Bounds.X + \':\' + $_.Bounds.Y + \':\' + $_.Bounds.Width + \':\' + $_.Bounds.Height + \':\' + $_.Primary }"';

    exec(cmd, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
        isQueryingWindowsScreens = false;
        if (err || !stdout) return;

        const screens: WindowsScreenInfo[] = [];
        const lines = stdout.trim().split(/\r?\n/);
        for (const line of lines) {
            const parts = line.trim().split(":");
            if (parts.length >= 6) {
                const device = parts[0];
                const screenNumber = parseInt(device.replace(/\D/g, "") || "1", 10);
                const bounds = {
                    x: parseInt(parts[1], 10),
                    y: parseInt(parts[2], 10),
                    width: parseInt(parts[3], 10),
                    height: parseInt(parts[4], 10)
                };
                const isPrimary = parts[5].toLowerCase() === "true";
                screens.push({ device, screenNumber, bounds, isPrimary });
            }
        }
        if (screens.length > 0) {
            cachedWindowsScreens = screens;
        }
    });
}

function invalidate() {
    cachedSources = null;
    queryWindowsScreens();
}

function initListeners() {
    if (initialized) return;
    initialized = true;
    screen.on("display-added", invalidate);
    screen.on("display-removed", invalidate);
    screen.on("display-metrics-changed", invalidate);
    queryWindowsScreens();
}

// Proactively initialize screen queries on module load so cache is ready before first stream
initListeners();

async function getSources() {
    const displays = screen.getAllDisplays();
    if (cachedSources && displays.length === lastDisplayCount) {
        return cachedSources;
    }
    if (sourcesPromise) {
        return await sourcesPromise;
    }
    lastDisplayCount = displays.length;
    sourcesPromise = desktopCapturer.getSources({
        types: ["screen"],
        fetchWindowIcons: false,
        thumbnailSize: { width: 160, height: 160 }
    }).then(sources => {
        cachedSources = sources;
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

        const displays = screen.getAllDisplays();
        if (displays.length <= 1) return null;

        const point = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(point);
        const sources = await getSources();
        if (!sources.length) return null;

        const displayIdStr = display.id.toString();

        // 1. Direct display_id match
        let match = sources.find(s => Boolean(s.display_id) && s.display_id === displayIdStr);

        // 1b. Direct screen:<id>:0 match
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
        if (!match && cachedWindowsScreens && cachedWindowsScreens.length > 0) {
            const primaryDisplay = screen.getPrimaryDisplay();
            let matchedWinScreen: WindowsScreenInfo | null = null;

            // 3a. Primary display matching
            if (display.id === primaryDisplay.id || (display.bounds.x === 0 && display.bounds.y === 0)) {
                matchedWinScreen = cachedWindowsScreens.find(ws => ws.isPrimary) ?? null;
            }

            // 3b. Relative coordinate direction from Primary
            if (!matchedWinScreen) {
                const primaryWs = cachedWindowsScreens.find(ws => ws.isPrimary);
                if (primaryWs) {
                    const dipDx = display.bounds.x - primaryDisplay.bounds.x;
                    const dipDy = display.bounds.y - primaryDisplay.bounds.y;

                    matchedWinScreen = cachedWindowsScreens.find(ws => {
                        if (ws.isPrimary) return false;
                        const physDx = ws.bounds.x - primaryWs.bounds.x;
                        const physDy = ws.bounds.y - primaryWs.bounds.y;

                        const xMatch = (dipDx === 0 && physDx === 0) ||
                                       (dipDx > 0 && physDx > 0) ||
                                       (dipDx < 0 && physDx < 0);
                        const yMatch = (dipDy === 0 && physDy === 0) ||
                                       (dipDy > 0 && physDy > 0) ||
                                       (dipDy < 0 && physDy < 0);

                        return xMatch && yMatch;
                    }) ?? null;
                }
            }

            // 3c. Closest center distance fallback
            if (!matchedWinScreen) {
                let bestDist = Infinity;
                for (const ws of cachedWindowsScreens) {
                    const dist = Math.hypot(
                        (display.bounds.x + display.bounds.width / 2) - (ws.bounds.x + ws.bounds.width / 2),
                        (display.bounds.y + display.bounds.height / 2) - (ws.bounds.y + ws.bounds.height / 2)
                    );
                    if (dist < bestDist) {
                        bestDist = dist;
                        matchedWinScreen = ws;
                    }
                }
            }

            if (matchedWinScreen) {
                const targetScreenNum = matchedWinScreen.screenNumber;
                match = sources.find(s => {
                    const m = s.name.match(/(?:screen|écran|pantalla|bildschirm|display)?\s*(\d+)/i);
                    return m ? parseInt(m[1], 10) === targetScreenNum : false;
                });
                if (!match && targetScreenNum >= 1 && targetScreenNum <= sources.length) {
                    match = sources[targetScreenNum - 1];
                }
            }
        }

        // 4. Primary vs Secondary index matching fallback
        if (!match && sources.length === displays.length) {
            const primaryDisplay = screen.getPrimaryDisplay();
            const isPrimary = display.id === primaryDisplay.id || (display.bounds.x === 0 && display.bounds.y === 0);
            if (isPrimary && sources[0]) {
                match = sources[0];
            } else if (!isPrimary && sources.length === 2 && sources[1]) {
                match = sources[1];
            } else {
                const displayIndex = displays.findIndex(d => d.id === display.id);
                if (displayIndex !== -1 && sources[displayIndex]) {
                    match = sources[displayIndex];
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
            if (sources.length === 2) {
                const other = sources.find(s => s.id !== currentMatchId);
                if (other) match = other;
            } else {
                const idx = sources.findIndex(s => s.id === currentMatchId);
                if (idx !== -1) {
                    match = sources[(idx + 1) % sources.length];
                }
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
