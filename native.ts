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
    cachedWindowsScreens = null;
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

        // 1b. Direct screen:<id>:0 match if display.id is large unique ID
        if (!match && display.id > 1000) {
            match = sources.find(s => s.id === `screen:${displayIdStr}:0`);
        }

        // 2. Windows system screen geometry matching
        if (!match && cachedWindowsScreens && cachedWindowsScreens.length > 0) {
            const scale = display.scaleFactor || 1;
            const displayCenterX = (display.bounds.x + display.bounds.width / 2) * scale;
            const displayCenterY = (display.bounds.y + display.bounds.height / 2) * scale;

            let bestDist = Infinity;
            let matchedWinScreen: WindowsScreenInfo | null = null;

            for (const ws of cachedWindowsScreens) {
                const wsCenterX = ws.bounds.x + ws.bounds.width / 2;
                const wsCenterY = ws.bounds.y + ws.bounds.height / 2;
                const dist = Math.hypot(wsCenterX - displayCenterX, wsCenterY - displayCenterY);
                if (dist < bestDist) {
                    bestDist = dist;
                    matchedWinScreen = ws;
                }
            }

            if (matchedWinScreen) {
                const targetScreenNum = matchedWinScreen.screenNumber;
                match = sources.find(s => {
                    const numFromName = parseInt(s.name.replace(/\D/g, "") || "-1", 10);
                    if (numFromName === targetScreenNum) return true;
                    const parts = s.id.split(":");
                    if (parts.length >= 2) {
                        const numFromId = parseInt(parts[1], 10);
                        if (numFromId === targetScreenNum - 1) return true;
                    }
                    return false;
                });
            }
        }

        // 3. Orientation signature (Mixed portrait/landscape)
        if (!match && sources.length === displays.length) {
            const isPortraitDisplay = display.bounds.height > display.bounds.width;
            const portraitDisplays = displays.filter(d => d.bounds && d.bounds.height > d.bounds.width);
            const portraitSources = sources.filter(s => {
                const size = s.thumbnail.getSize();
                return size.height > size.width;
            });

            if (portraitDisplays.length > 0 && portraitDisplays.length < displays.length && portraitDisplays.length === portraitSources.length) {
                if (isPortraitDisplay && portraitDisplays.length === 1) {
                    match = portraitSources[0];
                } else if (!isPortraitDisplay && sources.length - portraitDisplays.length === 1) {
                    match = sources.find(s => !portraitSources.includes(s));
                }
            }
        }

        // 4. Unique aspect ratio signature
        if (!match && sources.length === displays.length) {
            const displayAspect = display.bounds.width / (display.bounds.height || 1);
            const matchingSources = sources.filter(s => {
                const size = s.thumbnail.getSize();
                if (!size.width || !size.height) return false;
                const aspect = size.width / size.height;
                return Math.abs(aspect - displayAspect) < 0.08;
            });

            if (matchingSources.length === 1) {
                match = matchingSources[0];
            }
        }

        // 5. Index fallback
        if (!match) {
            const displayIndex = displays.findIndex(d => d.id === display.id);
            if (displayIndex !== -1 && sources[displayIndex]) {
                match = sources[displayIndex];
            } else {
                match = sources[0];
            }
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
