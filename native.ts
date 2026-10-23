/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { desktopCapturer, IpcMainInvokeEvent, screen } from "electron";

let cachedSources: { id: string; name: string; display_id: string }[] | null = null;
let lastDisplayCount = 0;
let initialized = false;

function invalidate() {
    cachedSources = null;
}

function initListeners() {
    if (initialized) return;
    initialized = true;
    screen.on("display-added", invalidate);
    screen.on("display-removed", invalidate);
    screen.on("display-metrics-changed", invalidate);
}

async function getSources() {
    const displays = screen.getAllDisplays();
    if (cachedSources && displays.length === lastDisplayCount) {
        return cachedSources;
    }
    lastDisplayCount = displays.length;
    return cachedSources = await desktopCapturer.getSources({ types: ["screen"], fetchWindowIcons: false });
}

export async function getActiveScreenSource(_: IpcMainInvokeEvent) {
    initListeners();

    const displays = screen.getAllDisplays();
    if (displays.length <= 1) return null;

    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const sources = await getSources();

    const displayIdStr = display.id.toString();
    const match = sources.find(s => s.display_id === displayIdStr)
        ?? sources.find(s => s.id.includes(displayIdStr))
        ?? (sources.length === displays.length ? sources[displays.findIndex(d => d.id === display.id)] : null);

    if (!match) return null;

    return {
        sourceId: match.id,
        sourceName: match.name,
        displayId: display.id
    };
}
