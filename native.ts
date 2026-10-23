/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { desktopCapturer, IpcMainInvokeEvent, NativeImage, screen } from "electron";

let cachedSources: { id: string; name: string; display_id: string; thumbnail: NativeImage }[] | null = null;
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
    return cachedSources = await desktopCapturer.getSources({
        types: ["screen"],
        fetchWindowIcons: false,
        thumbnailSize: { width: 160, height: 160 }
    });
}

export async function getActiveScreenSource(_: IpcMainInvokeEvent, invert = false) {
    initListeners();

    const displays = screen.getAllDisplays();
    if (displays.length <= 1) return null;

    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const sources = await getSources();
    if (!sources.length) return null;

    const displayIdStr = display.id.toString();

    let match = sources.find(s => s.display_id && s.display_id === displayIdStr);

    if (!match && sources.length === displays.length) {
        const displayAspect = display.bounds.width / (display.bounds.height || 1);
        const displayIsPortrait = display.bounds.height > display.bounds.width;

        const portraitDisplayCount = displays.filter(d => d.bounds.height > d.bounds.width).length;
        if (portraitDisplayCount > 0 && portraitDisplayCount < displays.length) {
            match = sources.find(s => {
                const size = s.thumbnail.getSize();
                const isPortrait = size.height > size.width;
                return isPortrait === displayIsPortrait;
            });
        }

        if (!match) {
            let bestDiff = Infinity;
            let bestSource = sources[0];
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
            if (bestDiff < 0.15) {
                match = bestSource;
            }
        }
    }

    if (!match && sources.length === displays.length) {
        const sortedDisplays = [...displays].sort((a, b) =>
            (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y)
        );
        const sortedSources = [...sources].sort((a, b) => {
            const numA = parseInt(a.name.replace(/\D/g, "") || a.id.replace(/\D/g, "") || "0", 10);
            const numB = parseInt(b.name.replace(/\D/g, "") || b.id.replace(/\D/g, "") || "0", 10);
            return numA - numB;
        });

        const displayIndex = sortedDisplays.findIndex(d => d.id === display.id);
        if (displayIndex !== -1 && sortedSources[displayIndex]) {
            match = sortedSources[displayIndex];
        }
    }

    if (!match) {
        match = sources[0];
    }

    if (invert && sources.length === 2 && match) {
        const other = sources.find(s => s.id !== match!.id);
        if (other) match = other;
    }

    return {
        sourceId: match.id,
        sourceName: match.name,
        displayId: display.id
    };
}
