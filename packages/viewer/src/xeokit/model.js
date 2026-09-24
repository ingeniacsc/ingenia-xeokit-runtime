// SPDX-License-Identifier: AGPL-3.0-only

import { revealSceneObjectsBottomUp } from "./progressive-model-reveal.js";

const MODEL_READY_TIMEOUT_MS = 45_000;
const MAX_META_MODEL_BYTES = 64 * 1024 * 1024;
const MAX_GEOMETRY_SCOPE_BYTES = 16 * 1024 * 1024;
const MAX_GEOMETRY_SCOPE_IDENTIFIERS = 500_000;
const DISCIPLINE_CODE = /^[A-Z][A-Z0-9_]{1,31}$/;
const HEX_COLOR = /^#[A-F0-9]{6}$/;
const MODEL_READY_WATCHDOG_MS = 200;
const MODEL_READY_STABLE_SAMPLE_COUNT = 5;
const MODEL_FETCH_PROGRESS_START = 5;
const MODEL_FETCH_PROGRESS_END = 65;
const MODEL_FETCH_PROGRESS_HEARTBEAT_BYTES = 512 * 1024;
const TECHNICAL_PROPERTY_ACCESS_KEYS = Object.freeze([
  "objectName", "ifcType", "typeName", "globalId", "storey", "tag", "propertySets",
]);
const DENIED_TECHNICAL_PROPERTY_ACCESS = Object.freeze(
  Object.fromEntries(TECHNICAL_PROPERTY_ACCESS_KEYS.map((key) => [key, false])),
);
const scheduleFrame = (callback) => (typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame(callback) : globalThis.setTimeout(callback, 0));
const PROGRESSIVE_REVEAL_INTERVAL_MS = 48;
const scheduleRevealFrame = (callback) => scheduleFrame(() => {
  globalThis.setTimeout(callback, PROGRESSIVE_REVEAL_INTERVAL_MS);
});

async function readModelArtifact(response, descriptor, onProgress) {
  const reader = response.body?.getReader?.();
  if (!reader) return response.arrayBuffer();
  const expectedByteLength = Number(descriptor?.byteLength);
  const chunks = [];
  let receivedBytes = 0;
  let lastReportedBytes = 0;
  let lastPercent = MODEL_FETCH_PROGRESS_START;
  const reportProgress = (force = false) => {
    if (receivedBytes <= 0) return;
    const calculatedPercent = Number.isFinite(expectedByteLength) && expectedByteLength > 0
      ? Math.min(
        MODEL_FETCH_PROGRESS_END,
        MODEL_FETCH_PROGRESS_START + Math.floor(
          (receivedBytes / expectedByteLength) * (MODEL_FETCH_PROGRESS_END - MODEL_FETCH_PROGRESS_START),
        ),
      )
      : MODEL_FETCH_PROGRESS_START;
    const nextPercent = Math.max(lastPercent, calculatedPercent);
    if (!force && nextPercent === lastPercent
        && receivedBytes - lastReportedBytes < MODEL_FETCH_PROGRESS_HEARTBEAT_BYTES) return;
    lastPercent = nextPercent;
    lastReportedBytes = receivedBytes;
    onProgress?.({
      modelId: descriptor.modelId,
      percent: nextPercent,
      phase: "fetching",
      loadedBytes: receivedBytes,
    });
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      chunks.push(chunk);
      receivedBytes += chunk.byteLength;
      reportProgress();
    }
  } finally {
    reader.releaseLock?.();
  }
  reportProgress(true);
  const buffer = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer.buffer;
}

export function createModelController({ viewer, loader, onModelInvalidated, onAuthorityChanged, onProgress, onSelectionChanged }) {
  const models = new Map();
  const descriptors = new Map();
  const geometryScopes = new Map();
  const pendingLoads = new Map();

  function descriptorForObject(objectId) {
    const normalizedObjectId = String(objectId || "");
    return Array.from(descriptors.values()).find((candidate) => (
      normalizedObjectId.startsWith(`${candidate.modelId}#`)
    ));
  }

  function technicalPropertyAccessFor(objectId) {
    const candidate = descriptorForObject(objectId)?.technicalPropertyAccess;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
        || Object.keys(candidate).length !== TECHNICAL_PROPERTY_ACCESS_KEYS.length
        || TECHNICAL_PROPERTY_ACCESS_KEYS.some((key) => typeof candidate[key] !== "boolean")
        || Object.keys(candidate).some((key) => !TECHNICAL_PROPERTY_ACCESS_KEYS.includes(key))) {
      return DENIED_TECHNICAL_PROPERTY_ACCESS;
    }
    return candidate;
  }

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

  function remove(modelId, { notifySelection = true } = {}) {
    pendingLoads.get(modelId)?.abort();
    const selectedObjectIds = Array.from(viewer.scene?.selectedObjectIds || []).filter(Boolean);
    const removedSelection = selectedObjectIds.filter((objectId) => String(objectId).startsWith(`${modelId}#`));
    const remainingSelection = selectedObjectIds.filter((objectId) => !removedSelection.includes(objectId));
    if (removedSelection.length > 0) viewer.scene?.setObjectsSelected?.(removedSelection, false);
    const model = models.get(modelId);
    model?.destroy?.();
    models.delete(modelId);
    descriptors.delete(modelId);
    geometryScopes.delete(modelId);
    onModelInvalidated?.(modelId);
    if (notifySelection && removedSelection.length > 0) {
      const modelIds = new Set(remainingSelection.map((objectId) => String(objectId).split('#', 1)[0]).filter(Boolean));
      onSelectionChanged?.({
        identifiers: remainingSelection,
        ...(modelIds.size === 1 ? { modelVersionId: Array.from(modelIds)[0] } : {}),
      });
    }
  }

  async function loadMetaModelData(descriptor, signal) {
    if (!descriptor?.metaModelUrl) return undefined;
    const declaredSize = Number(descriptor.metaModelByteLength || 0);
    if (declaredSize > MAX_META_MODEL_BYTES) {
      throw new Error("Model metadata exceeds the isolated Viewer size limit.");
    }
    const response = await fetch(descriptor.metaModelUrl, {
      signal,
      method: "GET",
      headers: boundedHeaders(descriptor.metaModelRequestHeaders),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "default",
    });
    if (!response.ok) throw new Error(`Model metadata request failed (${response.status}).`);
    const metadataBuffer = await response.arrayBuffer();
    if (metadataBuffer.byteLength > MAX_META_MODEL_BYTES) {
      throw new Error("Model metadata exceeds the isolated Viewer size limit.");
    }
    if (descriptor.metaModelContentHash) {
      await verifyContentHash(metadataBuffer, descriptor.metaModelContentHash);
    }
    try {
      return JSON.parse(new TextDecoder().decode(metadataBuffer));
    } catch {
      throw new Error("Model metadata is not valid JSON.");
    }
  }

  async function loadGeometryScope(descriptor, signal) {
    if (!descriptor?.geometryScopeUrl) return Object.freeze({ mode: "all" });
    let response;
    try {
      response = await fetch(descriptor.geometryScopeUrl, {
      signal,
      method: "GET",
      headers: boundedHeaders(descriptor.requestHeaders),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      });
    } catch (error) {
      if (!signal.aborted && (error instanceof TypeError || error?.name === "TimeoutError")) {
        throw Object.assign(new Error("Model geometry scope is temporarily unavailable."), {
          protocolCode: "CAPABILITY_REFRESH_TRANSIENT", recoverable: true,
        });
      }
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Model geometry scope request failed (${response.status}).`);
      if ([408, 429].includes(response.status) || response.status >= 500) {
        error.protocolCode = "CAPABILITY_REFRESH_TRANSIENT";
        error.recoverable = true;
      }
      throw error;
    }
    const declaredSize = Number(response.headers.get("Content-Length") || 0);
    if (declaredSize > MAX_GEOMETRY_SCOPE_BYTES) {
      throw new Error("Model geometry scope exceeds the isolated Viewer size limit.");
    }
    let text;
    try {
      text = await response.text();
    } catch (error) {
      if (!signal.aborted && (error instanceof TypeError || error?.name === "TimeoutError")) {
        throw Object.assign(new Error("Model geometry scope is temporarily unavailable."), {
          protocolCode: "CAPABILITY_REFRESH_TRANSIENT", recoverable: true,
        });
      }
      throw error;
    }
    if (new TextEncoder().encode(text).byteLength > MAX_GEOMETRY_SCOPE_BYTES) {
      throw new Error("Model geometry scope exceeds the isolated Viewer size limit.");
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("Model geometry scope is not valid JSON.");
    }
    if (
      payload?.schemaVersion !== "viewer_geometry_scope.v1"
      || String(payload?.modelVersionId || "") !== String(descriptor.modelId)
    ) {
      throw new Error("Model geometry scope identity is invalid.");
    }
    const scope = payload.geometryScope;
    if (scope?.mode === "all") return Object.freeze({ mode: "all" });
    const identifiers = scope?.allowedObjectIds;
    if (
      scope?.mode !== "allowlist"
      || !Array.isArray(identifiers)
      || identifiers.length > MAX_GEOMETRY_SCOPE_IDENTIFIERS
      || identifiers.some((identifier) => (
        typeof identifier !== "string"
        || identifier.length < 1
        || identifier.length > 128
        || /[\r\n]/.test(identifier)
      ))
    ) {
      throw new Error("Model geometry scope is invalid.");
    }
    return Object.freeze({
      mode: "allowlist",
      allowedObjectIds: Object.freeze([...new Set(identifiers)]),
    });
  }

  function applyGeometryScope(modelId, scope, { preserveVisibility = false } = {}) {
    const prefix = `${modelId}#`;
    const modelObjectIds = Object.keys(viewer.scene?.objects || {}).filter((objectId) => (
      objectId.startsWith(prefix)
    ));
    if (scope?.mode !== "allowlist") return modelObjectIds.length;
    const allowed = new Set(scope.allowedObjectIds || []);
    const visibleObjectIds = modelObjectIds.filter((objectId) => allowed.has(objectId.slice(prefix.length)));
    if (preserveVisibility) {
      // Credential rotation must only restrict existing visibility. Re-enabling
      // allowed objects here would undo the user's hide/isolate decisions.
      const deniedObjectIds = modelObjectIds.filter((objectId) => !allowed.has(objectId.slice(prefix.length)));
      viewer.scene?.setObjectsVisible?.(deniedObjectIds, false);
    } else {
      viewer.scene?.setObjectsVisible?.(modelObjectIds, false);
      viewer.scene?.setObjectsVisible?.(visibleObjectIds, true);
    }
    return visibleObjectIds.length;
  }

  function rememberGeometryScope(modelId, scope) {
    geometryScopes.set(modelId, scope?.mode === "allowlist"
      ? Object.freeze({ mode: "allowlist", allowedObjectIds: new Set(scope.allowedObjectIds || []) })
      : Object.freeze({ mode: "all" }));
  }

  function isObjectAllowed(objectId) {
    const normalizedObjectId = String(objectId || "");
    const separator = normalizedObjectId.indexOf("#");
    if (separator <= 0) return true;
    const scope = geometryScopes.get(normalizedObjectId.slice(0, separator));
    if (!scope || scope.mode !== "allowlist") return true;
    return scope.allowedObjectIds.has(normalizedObjectId.slice(separator + 1));
  }

  function filterAllowedObjectIds(objectIds) {
    return Array.from(new Set((objectIds || []).filter((objectId) => isObjectAllowed(objectId))));
  }

  function enforceGeometryScopes() {
    const deniedObjectIds = Object.keys(viewer.scene?.objects || {}).filter((objectId) => !isObjectAllowed(objectId));
    viewer.scene?.setObjectsVisible?.(deniedObjectIds, false);
    return deniedObjectIds.length;
  }

  function getRenderableObjectCount(model, modelId, initialSceneObjectIds) {
    const sceneObjectIds = Object.keys(viewer.scene?.objects || {});
    const modelObjectCount = sceneObjectIds.filter((id) => id.startsWith(`${modelId}#`)).length;
    if (modelObjectCount > 0) return modelObjectCount;
    try {
      const modelCount = Number(model?.numEntities ?? model?.numObjects ?? 0);
      if (Number.isFinite(modelCount) && modelCount > 0) return modelCount;
    } catch {}
    // Older SDK finalization can expose unprefixed scene objects before the
    // model accessor settles. Count only objects introduced by this load.
    return initialSceneObjectIds
      ? sceneObjectIds.filter((id) => !initialSceneObjectIds.has(id)).length
      : 0;
  }

  function resolveRevealSceneObjects(modelId, geometryScope, initialSceneObjectIds, replaceAll) {
    const prefix = `${modelId}#`;
    const allSceneObjects = Object.entries(viewer.scene?.objects || {})
      .filter(([, sceneObject]) => Boolean(sceneObject))
      .map(([objectId, sceneObject]) => {
        let aabb;
        try { aabb = sceneObject.aabb; } catch {}
        return {
          id: String(sceneObject.id || objectId),
          aabb,
          sceneObject,
        };
      });
    const attributedObjects = allSceneObjects.filter(({ id }) => (
      id.startsWith(prefix)
    ));
    const newSceneObjects = allSceneObjects.filter(({ id }) => !initialSceneObjectIds.has(id));
    const scopedSceneObjects = attributedObjects.length || geometryScope?.mode === "allowlist"
      ? attributedObjects
      : (replaceAll ? allSceneObjects : newSceneObjects);
    return {
      all: scopedSceneObjects,
      allowed: geometryScope?.mode === "allowlist"
        ? scopedSceneObjects.filter(({ id }) => isObjectAllowed(id))
        : scopedSceneObjects,
    };
  }

  function setRevealObjectsVisible(sceneObjects, visible) {
    const identifiers = sceneObjects.map(({ id }) => id);
    viewer.scene?.setObjectsVisible?.(identifiers, visible);
    sceneObjects.forEach(({ sceneObject }) => {
      try { sceneObject.visible = visible; } catch {}
    });
  }

  function geometrySnapshotSignature(modelId, geometryScope, initialSceneObjectIds, replaceAll) {
    const sceneObjects = resolveRevealSceneObjects(
      modelId,
      geometryScope,
      initialSceneObjectIds,
      replaceAll,
    ).all;
    if (sceneObjects.length === 0) return "";
    const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    let boundedObjectCount = 0;
    sceneObjects.forEach(({ aabb: candidateAabb }) => {
      const aabb = Array.from(candidateAabb || []);
      if (aabb.length !== 6 || !aabb.every(Number.isFinite)) return;
      boundedObjectCount += 1;
      bounds[0] = Math.min(bounds[0], aabb[0]);
      bounds[1] = Math.min(bounds[1], aabb[1]);
      bounds[2] = Math.min(bounds[2], aabb[2]);
      bounds[3] = Math.max(bounds[3], aabb[3]);
      bounds[4] = Math.max(bounds[4], aabb[4]);
      bounds[5] = Math.max(bounds[5], aabb[5]);
    });
    if (boundedObjectCount === 0) return "";
    const normalizedBounds = bounds
      .map((value) => Math.round(value * 1_000) / 1_000)
      .join(",");
    return `${sceneObjects.length}:${boundedObjectCount}:${normalizedBounds}`;
  }

  async function revealLoadedSceneBottomUp(model, modelId, geometryScope, initialSceneObjectIds, replaceAll, signal) {
    signal.throwIfAborted();
    const sceneObjects = resolveRevealSceneObjects(
      modelId,
      geometryScope,
      initialSceneObjectIds,
      replaceAll,
    );
    if (geometryScope?.mode === "allowlist" && sceneObjects.all.length === 0) return 0;
    // Some SDK variants propagate model.visible=true to every child. Restore the
    // child mask synchronously before the first render, then reveal only batches.
    setModelVisible(model, true);
    setRevealObjectsVisible(sceneObjects.all, false);
    if (sceneObjects.allowed.length === 0) {
      return 0;
    }
    try { viewer.scene.render(true); } catch {}
    return revealSceneObjectsBottomUp(sceneObjects.allowed, {
      scheduleFrame: scheduleRevealFrame,
      onBatch: ({ batch, revealedCount, totalCount }) => {
        signal.throwIfAborted();
        setRevealObjectsVisible(batch, true);
        try { viewer.scene.render(true); } catch {}
        onProgress?.({
          modelId,
          percent: 71 + Math.round((revealedCount / totalCount) * 28),
          phase: "rendering",
        });
      },
    });
  }

  function setModelVisible(model, visible) {
    try {
      model.visible = visible;
    } catch {
      // Individual object visibility remains the fallback for SDK variants.
    }
  }

  function isRenderableAabb(aabb) {
    const values = Array.from(aabb || []);
    return values.length === 6
      && values.every((value) => Number.isFinite(value))
      && values[3] > values[0]
      && values[4] > values[1]
      && values[5] > values[2];
  }

  function fitLoadedScene(model) {
    const modelAabb = Array.from(model?.aabb || []);
    const aabb = isRenderableAabb(modelAabb)
      ? modelAabb
      : Array.from(viewer.scene?.getAABB?.() || []);
    if (!isRenderableAabb(aabb)) return;
    viewer.resize?.();
    viewer.cameraFlight?.stop?.();
    viewer.camera.projection = "perspective";
    const options = { aabb, fit: true, fitFOV: 36, projection: "perspective" };
    if (typeof viewer.cameraFlight?.jumpTo === "function") {
      viewer.cameraFlight.jumpTo(options);
    } else {
      viewer.cameraFlight?.flyTo?.({ ...options, duration: 0 });
    }
  }

  async function load(descriptor, { replaceAll = false, preserveCamera = false } = {}) {
    const modelId = descriptor?.modelId;
    if (pendingLoads.has(modelId)) {
      const active = descriptors.get(modelId);
      if (!models.has(modelId) || !active
        || String(active.revision) !== String(descriptor.revision)
        || String(active.contentHash).toLowerCase() !== String(descriptor.contentHash).toLowerCase()) {
        throw new Error("This model is already loading.");
      }
      // A timed-out credential refresh cannot overwrite a newer refresh. The
      // signal is checked again after the scope fetch, even if fetch ignores it.
      pendingLoads.get(modelId).abort();
    }
    const controller = new AbortController();
    pendingLoads.set(modelId, controller);
    try {
      return await loadInternal(descriptor, { replaceAll, preserveCamera }, controller.signal);
    } finally {
      if (pendingLoads.get(modelId) === controller) pendingLoads.delete(modelId);
    }
  }

  async function loadInternal(descriptor, { replaceAll, preserveCamera }, signal) {
    const disciplineCode = String(descriptor?.disciplineCode || "");
    const disciplineColor = String(descriptor?.disciplineColor || "").toUpperCase();
    const hasDisciplineAppearance = Boolean(disciplineCode || disciplineColor);
    if (!descriptor?.modelId || !descriptor?.artifactUrl || descriptor.format !== "xkt") {
      throw new Error("A bounded XKT model descriptor is required.");
    }
    if (hasDisciplineAppearance && (!DISCIPLINE_CODE.test(disciplineCode) || !HEX_COLOR.test(disciplineColor))) {
      throw new Error("Model discipline appearance is invalid.");
    }
    const geometryScope = await loadGeometryScope(descriptor, signal);
    signal.throwIfAborted();
    const existingDescriptor = descriptors.get(descriptor.modelId);
    const existingModel = models.get(descriptor.modelId);
    if (existingDescriptor && existingModel) {
      const sameImmutableVersion = String(existingDescriptor.revision) === String(descriptor.revision)
        && String(existingDescriptor.contentHash).toLowerCase() === String(descriptor.contentHash).toLowerCase();
      if (!sameImmutableVersion) {
        throw new Error("An active model identity cannot be reused for different BIM content.");
      }
      const previousScope = geometryScopes.get(descriptor.modelId);
      const nextIds = new Set(geometryScope.allowedObjectIds || []);
      const scopeChanged = previousScope?.mode !== geometryScope.mode
        || (geometryScope.mode === "allowlist" && (
          previousScope.allowedObjectIds.size !== nextIds.size
          || [...nextIds].some((id) => !previousScope.allowedObjectIds.has(id))
        ));
      const accessChanged = TECHNICAL_PROPERTY_ACCESS_KEYS.some((key) => (
        (existingDescriptor.technicalPropertyAccess?.[key] === true)
          !== (descriptor.technicalPropertyAccess?.[key] === true)
      ));
      if (scopeChanged || accessChanged) {
        onModelInvalidated?.(descriptor.modelId);
        // Clear stale selections and open details before acknowledging changed
        // authority; same-policy token rotation preserves the current selection.
        onAuthorityChanged?.(descriptor.modelId);
      }
      rememberGeometryScope(descriptor.modelId, geometryScope);
      descriptors.set(descriptor.modelId, descriptor);
      if (replaceAll) Array.from(models.keys())
        .filter((modelId) => modelId !== descriptor.modelId)
        .forEach((modelId) => remove(modelId));
      const scopedObjectCount = applyGeometryScope(descriptor.modelId, geometryScope, { preserveVisibility: true });
      const objectCount = geometryScope.mode === "allowlist"
        ? scopedObjectCount
        : getRenderableObjectCount(existingModel, descriptor.modelId);
      try { viewer.scene.render(true); } catch {}
      onProgress?.({ modelId: descriptor.modelId, percent: 100, phase: "ready" });
      return { modelId: descriptor.modelId, objectCount };
    }
    const initialSceneObjectIds = new Set(Object.keys(viewer.scene?.objects || {}));
    rememberGeometryScope(descriptor.modelId, geometryScope);
    onProgress?.({ modelId: descriptor.modelId, percent: MODEL_FETCH_PROGRESS_START, phase: "fetching", loadedBytes: 0 });
    const response = await fetch(descriptor.artifactUrl, {
      signal,
      method: "GET",
      headers: boundedHeaders(descriptor.requestHeaders),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "default",
    });
    if (!response.ok) throw new Error(`Model artifact request failed (${response.status}).`);
    const xkt = await readModelArtifact(response, descriptor, onProgress);
    signal.throwIfAborted();
    onProgress?.({ modelId: descriptor.modelId, percent: 66, phase: "verifying", loadedBytes: xkt.byteLength });
    await verifyContentHash(xkt, descriptor.contentHash);
    signal.throwIfAborted();
    let metaModelData;
    if (descriptor.metaModelUrl) {
      try {
        onProgress?.({ modelId: descriptor.modelId, percent: 67, phase: "metadata", loadedBytes: xkt.byteLength });
        metaModelData = await loadMetaModelData(descriptor, signal);
      } catch (error) {
        signal.throwIfAborted();
        onProgress?.({ modelId: descriptor.modelId, percent: 69, phase: "metadata-unavailable", loadedBytes: xkt.byteLength });
      }
    }
    signal.throwIfAborted();
    onProgress?.({ modelId: descriptor.modelId, percent: 70, phase: "parsing", loadedBytes: xkt.byteLength });
    let model;
    try {
      model = loader.load({
        id: descriptor.modelId,
        xkt,
        ...(metaModelData ? { metaModelData } : {}),
        edges: true,
        globalizeObjectIds: true,
      });
      // Prevent an unscoped or top-down paint between SDK parsing and the first
      // controlled reveal frame.
      setModelVisible(model, false);
    } catch (error) {
      geometryScopes.delete(descriptor.modelId);
      throw error;
    }
    models.set(descriptor.modelId, model);
    return new Promise((resolve, reject) => {
      let settled = false;
      let finishing = false;
      let readyTimeoutId = null;
      let readyWatchdogId = null;
      let lastGeometrySignature = "";
      let stableGeometrySampleCount = 0;
      const clearReadinessWatchers = () => {
        if (readyTimeoutId) globalThis.clearTimeout(readyTimeoutId);
        if (readyWatchdogId) globalThis.clearInterval(readyWatchdogId);
        readyTimeoutId = null;
        readyWatchdogId = null;
      };
      const finish = () => {
        if (settled || finishing) return;
        finishing = true;
        clearReadinessWatchers();
        scheduleFrame(async () => {
          if (settled || signal.aborted) return;
          // Geometry is already hash-verified. Presentation remains best-effort so
          // a transient frame fault cannot leave a valid model pending forever.
          if (!preserveCamera) {
            try { fitLoadedScene(model); } catch {}
          }
          try {
            await revealLoadedSceneBottomUp(
              model,
              descriptor.modelId,
              geometryScope,
              initialSceneObjectIds,
              replaceAll,
              signal,
            );
          } catch {
            if (settled || signal.aborted) return;
            setModelVisible(model, geometryScope?.mode !== "allowlist");
          }
          if (settled || signal.aborted) return;
          if (replaceAll) Array.from(models.keys())
            .filter((modelId) => modelId !== descriptor.modelId)
            .forEach((modelId) => remove(modelId));
          descriptors.set(descriptor.modelId, descriptor);
          const scopedObjectCount = applyGeometryScope(descriptor.modelId, geometryScope);
          const objectCount = geometryScope.mode === "allowlist"
            ? scopedObjectCount
            : getRenderableObjectCount(model, descriptor.modelId, initialSceneObjectIds);
          try { viewer.scene.render(true); } catch {}
          onProgress?.({ modelId: descriptor.modelId, percent: 100, phase: "ready" });
          settled = true;
          signal.removeEventListener("abort", abortLoad);
          resolve({ modelId: descriptor.modelId, objectCount });
        });
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abortLoad);
        clearReadinessWatchers();
        model.destroy?.();
        models.delete(descriptor.modelId);
        descriptors.delete(descriptor.modelId);
        geometryScopes.delete(descriptor.modelId);
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const abortLoad = () => fail(signal.reason);
      signal.addEventListener("abort", abortLoad, { once: true });
      model.on("loaded", finish);
      model.on("error", fail);

      const completeWhenGeometryIsStable = () => {
        const signature = geometrySnapshotSignature(
          descriptor.modelId,
          geometryScope,
          initialSceneObjectIds,
          replaceAll,
        );
        if (!signature) {
          lastGeometrySignature = "";
          stableGeometrySampleCount = 0;
          return;
        }
        if (signature === lastGeometrySignature) {
          stableGeometrySampleCount += 1;
        } else {
          lastGeometrySignature = signature;
          stableGeometrySampleCount = 1;
        }
        if (stableGeometrySampleCount >= MODEL_READY_STABLE_SAMPLE_COUNT) finish();
      };
      readyWatchdogId = globalThis.setInterval(completeWhenGeometryIsStable, MODEL_READY_WATCHDOG_MS);
      readyTimeoutId = globalThis.setTimeout(() => {
        fail(new Error(`Model ${descriptor.modelId} did not finish or expose stable geometry before timeout.`));
      }, MODEL_READY_TIMEOUT_MS);
    });
  }

  return Object.freeze({
    open: (descriptor) => load(descriptor, {
      replaceAll: true,
      preserveCamera: descriptor?.preserveCamera === true,
    }),
    add: (descriptor) => load(descriptor, { preserveCamera: descriptor?.preserveCamera === true }),
    replace: (descriptor) => load(descriptor, {
      replaceAll: true,
      preserveCamera: descriptor?.preserveCamera === true,
    }),
    remove,
    enforceGeometryScopes,
    filterAllowedObjectIds,
    isObjectAllowed,
    async createSelectionReferences(objectIds) {
      const groups = new Map();
      const references = new Map();
      for (const objectId of objectIds || []) {
        const normalizedObjectId = String(objectId || "");
        const descriptor = descriptorForObject(normalizedObjectId);
        if (!descriptor) throw new Error("The selected Viewer object is not part of an active model.");
        const group = groups.get(descriptor.modelId) || { descriptor, objectIds: [] };
        group.objectIds.push(normalizedObjectId);
        groups.set(descriptor.modelId, group);
      }
      await Promise.all(Array.from(groups.values()).map(async ({ descriptor, objectIds: groupObjectIds }) => {
        if (!descriptor.selectionReferenceUrl) {
          throw new Error("Viewer selection references are unavailable for this model.");
        }
        const response = await fetch(descriptor.selectionReferenceUrl, {
          method: "POST",
          headers: {
            ...boundedHeaders(descriptor.requestHeaders),
            "Content-Type": "application/json",
          },
          credentials: "omit",
          referrerPolicy: "no-referrer",
          body: JSON.stringify({ modelVersionId: descriptor.modelId, identifiers: groupObjectIds }),
        });
        if (!response.ok) throw new Error(`Viewer selection reference request failed (${response.status}).`);
        const payload = await response.json();
        if (!Array.isArray(payload?.references) || payload.references.length !== groupObjectIds.length) {
          throw new Error("Viewer selection reference response is invalid.");
        }
        groupObjectIds.forEach((objectId, index) => references.set(objectId, payload.references[index]));
      }));
      return objectIds.map((objectId) => {
        const reference = references.get(String(objectId || ""));
        if (!reference) throw new Error("Viewer selection reference response is incomplete.");
        return reference;
      });
    },
    list: () => Array.from(models.keys()),
    modelVersionIdFor: (objectId) => String(descriptorForObject(objectId)?.modelId || ""),
    capabilityIdFor: (objectId) => String(descriptorForObject(objectId)?.capabilityId || ""),
    disciplineCodeFor: (objectId) => String(descriptorForObject(objectId)?.disciplineCode || ""),
    disciplineColorFor: (objectId) => String(descriptorForObject(objectId)?.disciplineColor || ""),
    technicalPropertyAccessFor,
    listDescriptors: () => Array.from(descriptors.entries()).map(([modelId, descriptor]) => ({
      modelId,
      displayName: descriptor.displayName || modelId,
      revision: descriptor.revision,
      contentHash: descriptor.contentHash,
    })),
    destroy: () => Array.from(new Set([...pendingLoads.keys(), ...models.keys()]))
      .forEach((modelId) => remove(modelId, { notifySelection: false })),
  });
}
