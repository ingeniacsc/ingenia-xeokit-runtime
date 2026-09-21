// SPDX-License-Identifier: AGPL-3.0-only

const MAX_SNAPSHOT_DIMENSION = 4096;
const DEFAULT_SNAPSHOT_WIDTH = 1920;
const DEFAULT_SNAPSHOT_HEIGHT = 1080;

function normalizeDimension(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(Math.floor(numeric), MAX_SNAPSHOT_DIMENSION);
}

export function createSnapshotController(viewer, documentLike = globalThis.document) {
  function capture(options = {}) {
    const width = normalizeDimension(options.width, DEFAULT_SNAPSHOT_WIDTH);
    const height = normalizeDimension(options.height, DEFAULT_SNAPSHOT_HEIGHT);
    return {
      dataUrl: viewer.getSnapshot({
        width,
        height,
        format: "png",
        includeGizmos: false,
      }),
      width,
      height,
    };
  }

  function download(options = {}) {
    const { dataUrl, width, height } = capture(options);
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png")) {
      throw new Error("The viewer returned an invalid PNG snapshot.");
    }
    if (!documentLike?.createElement || !documentLike.body?.appendChild) {
      throw new Error("Snapshot downloads are unavailable in this browser.");
    }
    const link = documentLike.createElement("a");
    link.download = "InGenia_Verified_" + Date.now() + ".png";
    link.href = dataUrl;
    documentLike.body.appendChild(link);
    try {
      link.click();
    } finally {
      documentLike.body.removeChild?.(link);
    }
    return Object.freeze({ format: "png", width, height, downloaded: true });
  }

  return Object.freeze({ capture, download });
}
