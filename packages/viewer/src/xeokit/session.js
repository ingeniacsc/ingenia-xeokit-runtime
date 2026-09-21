// SPDX-License-Identifier: AGPL-3.0-only

export const VIEWER_SESSION_SCHEMA_VERSION = 1;
export const VIEWER_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const VIEWER_SESSION_MAX_STORED_BYTES = 256 * 1024;
export const VIEWER_SESSION_MAX_STORED_ENTRIES = 8;

const MAX_CLOCK_SKEW_MS = 30_000;
const MAX_MODELS = 64;
const MAX_MODEL_ID_LENGTH = 128;
const MAX_MODEL_REVISION_LENGTH = 128;
const MAX_COORDINATE_MAGNITUDE = 1e12;
const STATE_REF_PREFIX = "viewstate.session.";
const STORAGE_PREFIX = "ingenia:xeokit-viewer:session:v1:";
const OPAQUE_STATE_REF = /^viewstate\.session\.[A-Za-z0-9._~-]{16,128}$/;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]+$/;
const CONTENT_HASH = /^[a-f0-9]{64}$/i;
const PROJECTIONS = new Set(["perspective", "ortho"]);
const NAVIGATION_MODES = new Set(["orbit", "walk", "fly"]);
const COLOR_MODES = new Set(["source", "ifc", "discipline"]);
const DAY_NIGHT_MODES = new Set(["day", "night"]);

export class ViewerSessionStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ViewerSessionStateError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ViewerSessionStateError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, allowedKeys) {
  return isPlainObject(value)
    && Object.keys(value).every((key) => allowedKeys.has(key));
}

function estimateBytes(value) {
  try {
    return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isBoundedText(value, maxLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
    && SAFE_TEXT.test(value);
}

function normalizeModelDescriptors(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_MODELS) {
    fail("MODEL_SET_INVALID", "A bounded loaded-model set is required for Viewer session state.");
  }
  const descriptors = values.map((value) => {
    const revision = typeof value?.revision === "string"
      ? value.revision
      : (Number.isSafeInteger(value?.revision) && value.revision >= 0 ? String(value.revision) : "");
    const contentHash = typeof value?.contentHash === "string"
      ? value.contentHash.toLowerCase()
      : "";
    if (!isBoundedText(value?.modelId, MAX_MODEL_ID_LENGTH)
        || !isBoundedText(revision, MAX_MODEL_REVISION_LENGTH)
        || !CONTENT_HASH.test(contentHash)) {
      fail("MODEL_SET_INVALID", "The loaded-model descriptor set is malformed.");
    }
    return { modelId: value.modelId, revision, contentHash };
  });
  if (new Set(descriptors.map(({ modelId }) => modelId)).size !== descriptors.length) {
    fail("MODEL_SET_INVALID", "The loaded-model set contains duplicates.");
  }
  return descriptors.sort((left, right) => (
    left.modelId < right.modelId ? -1 : (left.modelId > right.modelId ? 1 : 0)
  ));
}

function validateStoredModelDescriptors(values) {
  if (!Array.isArray(values)
      || values.some((value) => !hasOnlyKeys(value, new Set(["modelId", "revision", "contentHash"])))) {
    fail("MALFORMED_STATE", "Stored Viewer model state is malformed.");
  }
  const normalized = normalizeModelDescriptors(values);
  if (normalized.some((value, index) => (
    value.modelId !== values[index].modelId
    || value.revision !== values[index].revision
    || value.contentHash !== values[index].contentHash
  ))) {
    fail("MALFORMED_STATE", "Stored Viewer model state is not canonical.");
  }
  return normalized;
}

function normalizeVector(value) {
  let vector;
  try {
    vector = Array.from(value || []);
  } catch {
    return null;
  }
  return vector.length === 3
    && vector.every((entry) => Number.isFinite(entry) && Math.abs(entry) <= MAX_COORDINATE_MAGNITUDE)
    ? vector
    : null;
}

function normalizeCamera(value) {
  if (!value || typeof value !== "object") return null;
  const eye = normalizeVector(value.eye);
  const look = normalizeVector(value.look);
  const up = normalizeVector(value.up);
  const projection = PROJECTIONS.has(value.projection) ? value.projection : "perspective";
  return eye && look && up ? { eye, look, up, projection } : null;
}

function validateStoredCamera(value) {
  if (!hasOnlyKeys(value, new Set(["eye", "look", "up", "projection"]))) {
    fail("MALFORMED_STATE", "Stored Viewer camera state is malformed.");
  }
  const normalized = normalizeCamera(value);
  if (!normalized || normalized.projection !== value.projection) {
    fail("MALFORMED_STATE", "Stored Viewer camera state is malformed.");
  }
  return normalized;
}

function normalizeNavigation(value, viewer) {
  if (NAVIGATION_MODES.has(value)) return value;
  const cameraControl = viewer?.cameraControl;
  if (cameraControl?.navMode === "firstPerson") {
    return cameraControl.constrainVertical ? "walk" : "fly";
  }
  return "orbit";
}

function normalizeAppearance(value) {
  return {
    colorMode: COLOR_MODES.has(value?.colorMode) ? value.colorMode : "source",
    dayNightMode: DAY_NIGHT_MODES.has(value?.dayNightMode) ? value.dayNightMode : "day",
  };
}

function validateStoredAppearance(value) {
  if (!hasOnlyKeys(value, new Set(["colorMode", "dayNightMode"]))) {
    fail("MALFORMED_STATE", "Stored Viewer appearance state is malformed.");
  }
  const normalized = normalizeAppearance(value);
  if (normalized.colorMode !== value.colorMode
      || normalized.dayNightMode !== value.dayNightMode) {
    fail("MALFORMED_STATE", "Stored Viewer appearance state is malformed.");
  }
  return normalized;
}

function defaultIdFactory() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  fail("STATE_REF_UNAVAILABLE", "Secure Viewer session references are unavailable.");
}

function resolveDefaultStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function validateStateRef(value) {
  if (typeof value !== "string" || !OPAQUE_STATE_REF.test(value)) {
    fail("INVALID_STATE_REF", "Viewer session state requires a bounded opaque reference.");
  }
  return value;
}

function readNow(clock) {
  const now = Number(clock());
  if (!Number.isSafeInteger(now) || now <= 0) {
    fail("CLOCK_INVALID", "Viewer session state requires a valid clock.");
  }
  return now;
}

function requireStorage(storage) {
  if (!storage
      || typeof storage.getItem !== "function"
      || typeof storage.setItem !== "function") {
    fail("STORAGE_UNAVAILABLE", "Viewer-origin session storage is unavailable.");
  }
  return storage;
}

function removeStoredSnapshot(storage, storageKey) {
  try {
    storage.removeItem?.(storageKey);
  } catch {
    // Cleanup is best-effort; the caller still fails closed on the original error.
  }
}

function listStoredSnapshotKeys(storage) {
  const length = Number(storage?.length);
  if (!Number.isSafeInteger(length) || length < 0 || typeof storage?.key !== "function") return [];
  const keys = [];
  for (let index = 0; index < length; index += 1) {
    const key = storage.key(index);
    if (typeof key === "string" && key.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  return keys;
}

function cleanupStoredSnapshots(
  storage,
  now,
  retainedKeys = new Set(),
  maxEntries = VIEWER_SESSION_MAX_STORED_ENTRIES,
) {
  const validEntries = [];
  listStoredSnapshotKeys(storage).forEach((storageKey) => {
    if (retainedKeys.has(storageKey)) {
      validEntries.push({ storageKey, createdAt: now });
      return;
    }
    try {
      const rawValue = storage.getItem(storageKey);
      const snapshot = parseStoredSnapshot(rawValue, now);
      validEntries.push({ storageKey, createdAt: snapshot.createdAt });
    } catch {
      removeStoredSnapshot(storage, storageKey);
    }
  });
  validEntries
    .sort((left, right) => (
      Number(retainedKeys.has(right.storageKey)) - Number(retainedKeys.has(left.storageKey))
      || right.createdAt - left.createdAt
    ))
    .slice(maxEntries)
    .forEach(({ storageKey }) => removeStoredSnapshot(storage, storageKey));
}

function sameModelSet(left, right) {
  return left.length === right.length
    && left.every((value, index) => (
      value.modelId === right[index].modelId
      && value.revision === right[index].revision
      && value.contentHash === right[index].contentHash
    ));
}

function createPresentation(graphics, navigationMode = graphics.navigation) {
  return Object.freeze({
    navigationMode,
    visualMode: graphics.appearance?.dayNightMode || "day",
    colorMode: graphics.appearance?.colorMode || "source",
  });
}

function resolveNavigationForDevice(navigationMode, isCoarsePointer) {
  return isCoarsePointer() && ["walk", "fly"].includes(navigationMode)
    ? "orbit"
    : navigationMode;
}

function parseStoredSnapshot(rawValue, now) {
  if (typeof rawValue !== "string") {
    fail("STATE_NOT_FOUND", "Viewer session state was not found.");
  }
  if (estimateBytes(rawValue) > VIEWER_SESSION_MAX_STORED_BYTES) {
    fail("STATE_TOO_LARGE", "Stored Viewer session state exceeds the byte limit.");
  }

  let candidate;
  try {
    candidate = JSON.parse(rawValue);
  } catch {
    fail("MALFORMED_STATE", "Stored Viewer session state is malformed.");
  }
  if (!hasOnlyKeys(candidate, new Set(["schemaVersion", "createdAt", "models", "graphics"]))) {
    fail("MALFORMED_STATE", "Stored Viewer session state is malformed.");
  }
  if (candidate.schemaVersion !== VIEWER_SESSION_SCHEMA_VERSION) {
    fail("SCHEMA_MISMATCH", "Stored Viewer session state uses an unsupported schema.");
  }
  if (!Number.isSafeInteger(candidate.createdAt)
      || candidate.createdAt <= 0
      || candidate.createdAt > now + MAX_CLOCK_SKEW_MS) {
    fail("MALFORMED_STATE", "Stored Viewer session state has an invalid timestamp.");
  }
  if (now - candidate.createdAt > VIEWER_SESSION_TTL_MS) {
    fail("STATE_EXPIRED", "Stored Viewer session state has expired.");
  }
  const models = validateStoredModelDescriptors(candidate.models);
  const graphics = candidate.graphics;
  if (!hasOnlyKeys(graphics, new Set(["camera", "navigation", "appearance"]))) {
    fail("MALFORMED_STATE", "Stored Viewer graphics state is malformed.");
  }
  if (!NAVIGATION_MODES.has(graphics.navigation)) {
    fail("MALFORMED_STATE", "Stored Viewer navigation state is malformed.");
  }
  return {
    schemaVersion: candidate.schemaVersion,
    createdAt: candidate.createdAt,
    models,
    graphics: {
      camera: validateStoredCamera(graphics.camera),
      navigation: graphics.navigation,
      appearance: validateStoredAppearance(graphics.appearance),
    },
  };
}

function requireOperation(controller, method, operations, args) {
  if (typeof controller?.[method] !== "function") {
    fail("CONTROLLER_UNAVAILABLE", "Viewer session restore controller is unavailable.");
  }
  operations.push(() => controller[method](...args));
}

function runRestoreTransaction(operations, rollbackOperations) {
  try {
    operations.forEach((operation) => operation());
  } catch (error) {
    let rollbackFailed = false;
    rollbackOperations.forEach((operation) => {
      try {
        operation();
      } catch {
        rollbackFailed = true;
      }
    });
    if (rollbackFailed) {
      fail("RESTORE_ROLLBACK_FAILED", "Viewer session restore failed and could not be rolled back safely.");
    }
    throw new ViewerSessionStateError(
      "SESSION_RESTORE_FAILED",
      String(error?.message || "Viewer session restore failed."),
    );
  }
}

export function createViewerSessionController({
  viewer,
  storage = resolveDefaultStorage(),
  idFactory = defaultIdFactory,
  clock = () => Date.now(),
  getLoadedModels,
  readGraphicsState,
  isCoarsePointer = () => false,
  model,
  camera,
  selection,
  visibility,
  appearance,
} = {}) {
  let currentStateRef = null;
  let currentModelFingerprint = "";
  const importedStateRefs = new Set();
  const readModels = () => normalizeModelDescriptors(
    getLoadedModels?.()
      ?? model?.listDescriptors?.(),
  );

  function captureGraphicsState() {
    const supplied = readGraphicsState?.();
    const state = isPlainObject(supplied) ? supplied : {};
    const cameraState = normalizeCamera(state.camera || viewer?.camera);
    if (!cameraState) {
      fail("CAMERA_STATE_INVALID", "A valid camera is required for Viewer session state.");
    }
    return {
      camera: cameraState,
      navigation: normalizeNavigation(state.navigation, viewer),
      appearance: normalizeAppearance(state.appearance),
    };
  }

  return Object.freeze({
    export() {
      const targetStorage = requireStorage(storage);
      const createdAt = readNow(clock);
      const models = readModels();
      const modelFingerprint = JSON.stringify(models);
      const stateRef = currentStateRef && currentModelFingerprint === modelFingerprint
        ? currentStateRef
        : validateStateRef(`${STATE_REF_PREFIX}${idFactory()}`);
      const storageKey = `${STORAGE_PREFIX}${stateRef}`;
      const snapshot = {
        schemaVersion: VIEWER_SESSION_SCHEMA_VERSION,
        createdAt,
        models,
        graphics: captureGraphicsState(),
      };
      const serialized = JSON.stringify(snapshot);
      if (estimateBytes(serialized) > VIEWER_SESSION_MAX_STORED_BYTES) {
        fail("STATE_TOO_LARGE", "Viewer session state exceeds the stored byte limit.");
      }
      cleanupStoredSnapshots(
        targetStorage,
        createdAt,
        new Set([storageKey]),
        VIEWER_SESSION_MAX_STORED_ENTRIES - 1,
      );
      try {
        targetStorage.setItem(storageKey, serialized);
      } catch {
        cleanupStoredSnapshots(
          targetStorage,
          createdAt,
          new Set([storageKey]),
          VIEWER_SESSION_MAX_STORED_ENTRIES - 1,
        );
        try {
          targetStorage.setItem(storageKey, serialized);
        } catch {
          fail("STORAGE_WRITE_FAILED", "Viewer session state could not be stored.");
        }
      }
      cleanupStoredSnapshots(targetStorage, createdAt, new Set([storageKey]));
      currentStateRef = stateRef;
      currentModelFingerprint = modelFingerprint;
      return Object.freeze({
        schemaVersion: VIEWER_SESSION_SCHEMA_VERSION,
        stateRef,
        createdAt,
        presentation: createPresentation(snapshot.graphics),
      });
    },

    import(stateRefCandidate) {
      const stateRef = validateStateRef(stateRefCandidate);
      const targetStorage = requireStorage(storage);
      const now = readNow(clock);
      const storageKey = `${STORAGE_PREFIX}${stateRef}`;
      cleanupStoredSnapshots(targetStorage, now, new Set([storageKey]));
      let rawValue;
      try {
        rawValue = targetStorage.getItem(storageKey);
      } catch {
        fail("STORAGE_READ_FAILED", "Viewer session state could not be read.");
      }
      let snapshot;
      try {
        snapshot = parseStoredSnapshot(rawValue, now);
      } catch (error) {
        removeStoredSnapshot(targetStorage, storageKey);
        throw error;
      }
      const currentModels = readModels();
      if (!sameModelSet(snapshot.models, currentModels)) {
        removeStoredSnapshot(targetStorage, storageKey);
        fail("MODEL_SET_MISMATCH", "Viewer session state does not match the loaded model set.");
      }
      if (importedStateRefs.has(stateRef)) {
        fail("STATE_REF_ALREADY_IMPORTED", "Viewer session state was already imported in this session.");
      }

      const graphics = snapshot.graphics;
      const restoredNavigation = resolveNavigationForDevice(graphics.navigation, isCoarsePointer);
      const previousGraphics = captureGraphicsState();
      const previousSelectedIds = Array.from(viewer?.scene?.selectedObjectIds || []);
      if (typeof visibility?.hiddenObjectIds !== "function") {
        fail("CONTROLLER_UNAVAILABLE", "Viewer session restore controller is unavailable.");
      }
      const previousHiddenIds = Array.from(visibility.hiddenObjectIds() || []);
      const operations = [];
      const rollbackOperations = [];

      requireOperation(visibility, "reset", operations, []);
      requireOperation(selection, "clear", operations, []);
      requireOperation(camera, "navigation", operations, [restoredNavigation]);
      if (graphics.camera) requireOperation(camera, "set", operations, [graphics.camera]);
      if (graphics.appearance?.colorMode) {
        requireOperation(appearance, "apply", operations, [{
          options: { mode: graphics.appearance.colorMode },
        }]);
      }
      if (graphics.appearance?.dayNightMode) {
        requireOperation(appearance, "dayNight", operations, [graphics.appearance.dayNightMode]);
      }

      requireOperation(visibility, "reset", rollbackOperations, []);
      requireOperation(visibility, "hide", rollbackOperations, [previousHiddenIds]);
      requireOperation(selection, "clear", rollbackOperations, []);
      requireOperation(selection, "select", rollbackOperations, [previousSelectedIds]);
      requireOperation(camera, "navigation", rollbackOperations, [previousGraphics.navigation]);
      requireOperation(camera, "set", rollbackOperations, [previousGraphics.camera]);
      requireOperation(appearance, "apply", rollbackOperations, [{
        options: { mode: previousGraphics.appearance.colorMode },
      }]);
      requireOperation(appearance, "dayNight", rollbackOperations, [
        previousGraphics.appearance.dayNightMode,
      ]);

      runRestoreTransaction(operations, rollbackOperations);
      importedStateRefs.add(stateRef);
      currentStateRef = stateRef;
      currentModelFingerprint = JSON.stringify(currentModels);
      return Object.freeze({
        schemaVersion: snapshot.schemaVersion,
        stateRef,
        createdAt: snapshot.createdAt,
        presentation: createPresentation(snapshot.graphics, restoredNavigation),
      });
    },
  });
}
