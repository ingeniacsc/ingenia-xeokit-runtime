// SPDX-License-Identifier: AGPL-3.0-only

export function createModelController({ viewer, loader, onProgress }) {
  const models = new Map();

  function boundedHeaders(candidate) {
    if (candidate === undefined) return Object.freeze({});
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Model request headers must be a bounded object.");
    }
    const entries = Object.entries(candidate);
    if (entries.length > 4) throw new Error("Too many model request headers.");
    const headers = {};
    for (const [name, value] of entries) {
      if (!/^X-[A-Za-z0-9-]{1,64}$/.test(name) || typeof value !== "string"
          || value.length < 1 || value.length > 512 || /[\r\n]/.test(value)) {
        throw new Error("Model request header is invalid.");
      }
      headers[name] = value;
    }
    return Object.freeze(headers);
  }

  async function verifyContentHash(buffer, expected) {
    if (!/^[a-fA-F0-9]{64}$/.test(String(expected || "")) || !globalThis.crypto?.subtle) {
      throw new Error("Model content hash cannot be verified.");
    }
    const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
    const actual = Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    if (actual !== String(expected).toLowerCase()) {
      throw new Error("Model content hash mismatch.");
    }
  }

  function remove(modelId) {
    const model = models.get(modelId);
    model?.destroy?.();
    models.delete(modelId);
  }

  async function load(descriptor, replace = false) {
    if (!descriptor?.modelId || !descriptor?.artifactUrl || descriptor.format !== "xkt") {
      throw new Error("A bounded XKT model descriptor is required.");
    }
    if (replace) Array.from(models.keys()).forEach(remove);
    remove(descriptor.modelId);
    onProgress?.({ modelId: descriptor.modelId, percent: 5, phase: "fetching" });
    const response = await fetch(descriptor.artifactUrl, {
      method: "GET",
      headers: boundedHeaders(descriptor.requestHeaders),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "default",
    });
    if (!response.ok) throw new Error(`Model artifact request failed (${response.status}).`);
    const xkt = await response.arrayBuffer();
    await verifyContentHash(xkt, descriptor.contentHash);
    onProgress?.({ modelId: descriptor.modelId, percent: 70, phase: "parsing" });
    const model = loader.load({
      id: descriptor.modelId,
      xkt,
      edges: true,
      globalizeObjectIds: true,
    });
    models.set(descriptor.modelId, model);
    return new Promise((resolve, reject) => {
      model.on("loaded", () => {
        onProgress?.({ modelId: descriptor.modelId, percent: 100, phase: "ready" });
        resolve({ modelId: descriptor.modelId, objectCount: model.numObjects ?? null });
      });
      model.on("error", (error) => {
        models.delete(descriptor.modelId);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  return Object.freeze({
    open: (descriptor) => load(descriptor, true),
    add: (descriptor) => load(descriptor, false),
    replace: (descriptor) => load(descriptor, true),
    remove,
    list: () => Array.from(models.keys()),
    destroy: () => Array.from(models.keys()).forEach(remove),
  });
}
