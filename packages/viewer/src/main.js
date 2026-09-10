// SPDX-License-Identifier: AGPL-3.0-only
import "./styles.css";
import { readBootstrapConfiguration, createViewerBridge } from "./protocol-bridge/bridge.js";
import { createModelController } from "./xeokit/model.js";
import { createCameraController } from "./xeokit/camera.js";
import { createOrbitPivotController } from "./xeokit/orbit-pivot.js";
import { createSelectionController } from "./xeokit/selection.js";
import { createAppearanceController } from "./xeokit/appearance.js";
import { createVisibilityController } from "./xeokit/visibility.js";
import { createSnapshotController } from "./xeokit/snapshot.js";
import { createMeasurementController } from "./xeokit/measurement.js";
import { createObjectIdentifierRegistry } from "./xeokit/object-identifiers.js";
import { createObjectLabelsController } from "./xeokit/labels.js";
import { createModelTreeController } from "./xeokit/tree.js";
import { createObjectPropertiesPanel } from "./xeokit/properties-panel.js";
import { createViewerSessionController } from "./xeokit/session.js";
import { createSelectionOperationStatus } from "./xeokit/selection-operation-status.js";

const status = document.querySelector("#viewport-status");
const title = document.querySelector("#status-title");
const detail = document.querySelector("#status-detail");
const progress = document.querySelector("#status-progress");
const viewerIsEmbedded = window.parent !== window;
const selectionOperationStatus = createSelectionOperationStatus({
  container: viewerIsEmbedded ? null : document.querySelector("#selection-operation-status"),
  locale: new URLSearchParams(window.location.search).get("locale") || "en",
});

function createViewportStatusCopy(locale) {
  const vietnamese = locale === "vi";
  return {
    runtime: vietnamese
      ? { heading: "Đang chuẩn bị trình xem BIM", message: "Đang khởi tạo đồ họa 3D bảo mật." }
      : { heading: "Preparing the BIM Viewer", message: "Initializing the protected 3D graphics runtime." },
    awaitingModel: vietnamese
      ? { heading: "Trình xem BIM đã sẵn sàng", message: "Đang chờ mô hình từ hệ thống." }
      : { heading: "BIM Viewer ready", message: "Waiting for a model from the host." },
    model: vietnamese
      ? { heading: "Đang mở mô hình BIM" }
      : { heading: "Opening BIM model" },
    contextLost: vietnamese
      ? { heading: "Đồ họa 3D đang được khôi phục", message: "Đang yêu cầu khôi phục phiên xem an toàn." }
      : { heading: "Restoring 3D graphics", message: "Requesting a safe viewer recovery." },
    contextRestored: vietnamese
      ? { heading: "Trình xem BIM đã khôi phục", message: "Đồ họa 3D đã sẵn sàng." }
      : { heading: "BIM Viewer restored", message: "3D graphics are ready." },
    contextUnavailable: vietnamese
      ? { heading: "Không thể khởi tạo đồ họa 3D" }
      : { heading: "3D graphics are unavailable" },
    unavailable: vietnamese
      ? { heading: "Trình xem BIM chưa sẵn sàng" }
      : { heading: "BIM Viewer unavailable" },
    phases: vietnamese
      ? {
        fetching: "Đang nhận dữ liệu mô hình",
        verifying: "Đang xác thực hình học",
        metadata: "Đang đọc dữ liệu IFC",
        "metadata-unavailable": "Đang hoàn thiện hình học",
        parsing: "Đang dựng mô hình 3D",
        rendering: "Đang hiển thị hình học từ thấp lên cao",
        ready: "Mô hình đã sẵn sàng",
      }
      : {
        fetching: "Receiving model data",
        verifying: "Verifying geometry",
        metadata: "Reading IFC data",
        "metadata-unavailable": "Finalizing geometry",
        parsing: "Building the 3D model",
        rendering: "Rendering geometry from lower to upper levels",
        ready: "Model ready",
      },
  };
}

function showStatus(tone, heading, message, percent = 0) {
  // Embedded notifications belong to the host; protocol error reporting remains active.
  status.hidden = viewerIsEmbedded;
  if (viewerIsEmbedded) return;
  status.dataset.tone = tone;
  title.textContent = heading;
  detail.textContent = message;
  progress.value = Math.max(0, Math.min(100, percent));
}

function resolveCommandSelection(runtime, identifiers, tokens, useCurrentSelection) {
  const requested = identifiers.toObjectIds(tokens);
  if (!useCurrentSelection) return requested;
  const current = Array.from(runtime.viewer.scene.selectedObjectIds || []);
  return requested.some((objectId) => current.includes(objectId)) ? current : requested;
}

async function bootstrap() {
  let bridge;
  let settleRuntime;
  let resources = null;
  let statusCopy = createViewportStatusCopy("vi");
  const runtimeReady = new Promise((resolve, reject) => {
    settleRuntime = { resolve, reject };
  });
  // Report initialization failures through model.open instead of leaving the host waiting.
  runtimeReady.catch(() => {});
  const withRuntime = (operation) => (...args) => runtimeReady.then(
    (runtimeResources) => operation(runtimeResources, ...args),
  );

  try {
    const bootstrap = readBootstrapConfiguration(
      window.location,
      import.meta.env.VITE_ALLOWED_PARENT_ORIGINS,
    );
    document.documentElement.lang = bootstrap.locale;
    statusCopy = createViewportStatusCopy(bootstrap.locale);
    showStatus("loading", statusCopy.runtime.heading, statusCopy.runtime.message, 0);
    bridge = createViewerBridge({
      parentWindow: window.parent,
      ...bootstrap,
      viewerBuild: String(import.meta.env.VITE_VIEWER_BUILD || "local-dev").padEnd(7, "0"),
      handlers: {
        model: {
          open: withRuntime(({ appearance, model, spatial, tree }, descriptor) => {
            spatial.clearSpaceClip();
            return Promise.resolve(model.open(descriptor)).then((result) => {
              tree.syncModels(model.listDescriptors());
              appearance.reapply();
              return result;
            });
          }),
          add: withRuntime(({ appearance, model, spatial, tree }, descriptor) => Promise.resolve(model.add(descriptor)).then(async (result) => {
            tree.syncModels(model.listDescriptors());
            appearance.reapply();
            await spatial.applySpaceClipForModel();
            return result;
          })),
          replace: withRuntime(({ appearance, model, spatial, tree }, descriptor) => {
            spatial.clearSpaceClip();
            return Promise.resolve(model.replace(descriptor)).then((result) => {
              tree.syncModels(model.listDescriptors());
              appearance.reapply();
              return result;
            });
          }),
          remove: withRuntime(({ model, spatial, tree }, modelId) => {
            spatial.clearSpaceClipForModel(modelId);
            const result = model.remove(modelId);
            tree.syncModels(model.listDescriptors());
            return result;
          }),
        },
        camera: {
          fit: withRuntime(({ camera, identifiers, runtime }, tokens, useCurrentSelection) => camera.fit(
            resolveCommandSelection(runtime, identifiers, tokens, useCurrentSelection),
          )),
          set: withRuntime(({ camera }, payload) => camera.set(payload)),
          view: withRuntime(({ camera }, view) => camera.view(view)),
          navigation: withRuntime(({ camera, orbitPivot }, payload) => {
            const mode = payload?.mode;
            camera.navigation(mode);
            orbitPivot.setEnabled(mode === "orbit" && payload?.orbitPivotEnabled === true);
          }),
        },
        appearance: {
          apply: withRuntime(({ appearance, identifiers, runtime }, payload) => appearance.apply({
            identifiers: payload.identifiers?.length
              ? resolveCommandSelection(
                runtime,
                identifiers,
                payload.identifiers,
                payload.options?.useCurrentSelection === true,
              )
              : [],
            options: payload.options || {},
          })),
          dayNight: withRuntime(({ appearance }, mode) => appearance.dayNight(mode)),
        },
        spatial: {
          setSection: withRuntime(({ spatial }, payload) => spatial.setSection(payload)),
          clearSection: withRuntime(({ spatial }, payload) => spatial.clearSection(payload)),
          flipSection: withRuntime(({ spatial }, payload) => spatial.flipSection(payload)),
          setSpaceClip: withRuntime(({ spatial }) => spatial.setSpaceClip()),
          clearSpaceClip: withRuntime(({ spatial }) => spatial.clearSpaceClip()),
          requestLevelOptions: withRuntime(({ spatial }) => spatial.requestLevelOptions()),
          setLevelClip: withRuntime(({ spatial }, payload) => spatial.setLevelClip(payload)),
          clearLevelClip: withRuntime(({ spatial }) => spatial.clearLevelClip()),
        },
        selection: {
          select: withRuntime(({ selection, identifiers }, tokens) => selection.select(identifiers.toObjectIds(tokens))),
          mode: withRuntime(({ selection }, mode) => selection.setMode(mode)),
          clear: withRuntime(({ selection }) => selection.clear()),
          visible: withRuntime(({ selection, identifiers }, tokens) => selection.selectVisible(identifiers.toObjectIds(tokens))),
          match: withRuntime(({ selection, identifiers }, tokens, scope) => selection.match(identifiers.toObjectIds(tokens), scope)),
        },
        measurement: {
          mode: withRuntime(({ measurement }, enabled) => measurement.mode(enabled)),
          clear: withRuntime(({ measurement }) => measurement.clear()),
        },
        labels: {
          mode: withRuntime(({ labels, identifiers }, enabled, tokens) => (
            labels.mode(enabled, identifiers.toObjectIds(tokens || []))
          )),
        },
        tree: {
          mode: withRuntime(({ tree }, open) => tree.mode(open)),
        },
        properties: {
          mode: withRuntime(({ objectProperties, runtime }, enabled) => objectProperties.mode(enabled, {
            identifiers: runtime.viewer.scene.selectedObjectIds,
            scope: "selection",
          })),
        },
        session: {
          export: withRuntime(({ viewSession }) => viewSession.export()),
          import: withRuntime(({ viewSession }, stateRef) => viewSession.import(stateRef)),
        },
        visibility: {
          show: withRuntime(({ visibility, identifiers }, tokens) => visibility.show(identifiers.toObjectIds(tokens))),
          hide: withRuntime(({ visibility, identifiers, runtime }, tokens, useCurrentSelection) => visibility.hide(
            resolveCommandSelection(runtime, identifiers, tokens, useCurrentSelection),
          )),
          isolate: withRuntime(({ visibility, identifiers, runtime }, tokens, useCurrentSelection) => visibility.isolate(
            resolveCommandSelection(runtime, identifiers, tokens, useCurrentSelection),
          )),
          reset: withRuntime(({ spatial, visibility }) => {
            spatial.clearSpaceClip();
            return visibility.reset();
          }),
        },
        snapshot: {
          capture: withRuntime(({ snapshot }, payload) => snapshot.download(payload)),
        },
        reliability: {
          restoreContext: withRuntime(({ runtime }) => runtime.requestContextRestore()),
        },
      },
    });
    const [{ createViewportRuntime }, { createSpatialController }] = await Promise.all([
      import("./xeokit/runtime.js"),
      import("./xeokit/spatial.js"),
    ]);
    const runtime = createViewportRuntime({
      canvas: document.querySelector("#xeokit-canvas"),
      navCubeCanvas: document.querySelector("#navcube-canvas"),
      onContextLost: () => {
        showStatus("error", statusCopy.contextLost.heading, statusCopy.contextLost.message);
        bridge?.post("context.lost", {});
      },
      onContextRestored: () => {
        showStatus("ready", statusCopy.contextRestored.heading, statusCopy.contextRestored.message, 100);
        bridge?.post("context.restored", {});
      },
      onContextRestoreFailed: (message) => {
        showStatus("error", statusCopy.contextUnavailable.heading, message);
        bridge?.post("context.restore-failed", {
          code: "WEBGL_CONTEXT_RESTORE_FAILED",
          message,
          recoverable: true,
          recoveryAction: "reload_iframe_cache_bust",
        });
      },
    });
    const identifiers = createObjectIdentifierRegistry();
    let model = null;
    let objectProperties = null;
    let selection = null;
    let orbitPivot = null;
    let tree = null;
    let selectionPublicationRevision = 0;
    const createPublicSelectionPayload = async (payload, { allowEmpty = false } = {}) => {
      const privateIdentifiers = Array.isArray(payload?.identifiers) ? payload.identifiers.filter(Boolean) : [];
      if (privateIdentifiers.length === 0) {
        if (allowEmpty) return { identifiers: [] };
        throw new Error("A model-attributed Viewer selection is required.");
      }
      const modelVersionIds = new Set(
        privateIdentifiers.map((identifier) => model.modelVersionIdFor(identifier)).filter(Boolean),
      );
      if (modelVersionIds.size !== 1) {
        throw new Error("Viewer selection model attribution is invalid.");
      }
      const [modelVersionId] = modelVersionIds;
      const publicIdentifiers = await model.createSelectionReferences(privateIdentifiers);
      publicIdentifiers.forEach((reference, index) => identifiers.register(reference, privateIdentifiers[index]));
      return { identifiers: publicIdentifiers, modelVersionId };
    };
    const resolveCurrentPublicSelection = async (payload, options, isCurrent = () => true) => {
      const revision = ++selectionPublicationRevision;
      const publicPayload = await createPublicSelectionPayload(payload, options);
      return revision === selectionPublicationRevision && isCurrent() ? publicPayload : null;
    };
    const publishSelectionChanged = async (payload) => {
      if (objectProperties?.isOpen()) {
        if (payload?.identifiers?.length) objectProperties.show(payload);
        else objectProperties.hide();
      }
      const publicPayload = await resolveCurrentPublicSelection(payload, { allowEmpty: true });
      if (publicPayload) bridge?.post("selection.changed", publicPayload);
    };
    model = createModelController({
      viewer: runtime.viewer,
      loader: runtime.loader,
      onProgress: ({ modelId, percent, phase, loadedBytes }) => {
        const phaseMessage = statusCopy.phases[phase] || statusCopy.phases.parsing;
        showStatus(percent === 100 ? "ready" : "loading", statusCopy.model.heading, `${modelId} · ${phaseMessage}`, percent);
        bridge?.post("model.progress", { modelId, percent, phase, loadedBytes });
      },
      onSelectionChanged: (payload) => { void publishSelectionChanged(payload).catch(() => {}); },
      onModelInvalidated: (modelId) => selection?.invalidateModel(modelId),
    });
    const camera = createCameraController(runtime.viewer);
    orbitPivot = createOrbitPivotController(runtime.viewer, {
      marker: document.querySelector("#orbit-pivot-marker"),
    });
    const visibility = createVisibilityController(runtime.viewer, {
      isObjectAllowed: (objectId) => model.isObjectAllowed(objectId),
    });
    const appearance = createAppearanceController(runtime.viewer, { model, visibility });
    const spatial = createSpatialController(runtime.viewer, {
      axisLabelContainer: document.querySelector("#section-axis-labels"),
      model,
      onLevelClipChanged: (payload) => bridge?.post("spatial.level-clip.changed", payload),
      onLevelsChanged: (payload) => bridge?.post("spatial.levels.changed", payload),
      onSpaceClipChanged: (payload) => bridge?.post("spatial.space-clip.changed", payload),
      visibility,
    });
    const snapshot = createSnapshotController(runtime.viewer);
    const measurement = createMeasurementController(runtime.viewer, {
      onChanged: (payload) => bridge?.post("measurement.changed", payload),
    });
    const labels = createObjectLabelsController(runtime.viewer, {
      container: document.querySelector("#viewport-shell"),
    });
    objectProperties = createObjectPropertiesPanel(runtime.viewer, {
      container: document.querySelector("#viewport-shell"),
      locale: bootstrap.locale,
      onBeforeShow: () => tree?.mode(false),
      onVisibilityChange: (open) => bridge?.post("properties.changed", { open }),
      resolveAccess: (objectId) => model.technicalPropertyAccessFor(objectId),
    });
    const publishSelection = async (payload, isCurrent = () => true) => {
      const publicPayload = await resolveCurrentPublicSelection(payload, undefined, isCurrent);
      if (!publicPayload) return null;
      bridge?.post("object.picked", publicPayload);
      bridge?.post("selection.changed", publicPayload);
      return publicPayload;
    };
    const verifySelectionSeed = (payload, isCurrent) => (
      resolveCurrentPublicSelection(payload, undefined, isCurrent)
    );
    tree = createModelTreeController(runtime.viewer, {
      container: document.querySelector("#viewport-shell"),
      locale: bootstrap.locale,
      onOpenChange: (open) => bridge?.post("tree.changed", { open }),
      onSelect: (payload) => {
        if (!payload) {
          objectProperties.hide();
          bridge?.post("selection.changed", { identifiers: [] });
        }
        else void publishSelection(payload).catch(() => {});
      },
    });
    selection = createSelectionController(
      runtime.viewer,
      (payload, isCurrent) => publishSelection(payload, isCurrent),
      (payload, isCurrent) => (
        resolveCurrentPublicSelection(payload, undefined, isCurrent)
          .then((publicPayload) => {
            if (!publicPayload) return null;
            bridge?.post("selection.context-menu", {
              ...publicPayload,
              anchor: payload.anchor,
            });
            return publicPayload;
          })
      ),
      {
        isInteractionCaptured: () => measurement.active,
        onSelectionOperationCancelled: () => selectionOperationStatus.clear(),
        onSelectionSeedVerification: verifySelectionSeed,
        onSelectionCleared: () => {
          void publishSelectionChanged({ identifiers: [] }).catch(() => {});
        },
        onSelectionAppearanceChanged: () => appearance.reapply(),
        onOrbitPivot: (event) => orbitPivot?.setFromPointerEvent(event),
        onSelectionDetails: (payload) => {
          if (!payload.identifiers?.length) objectProperties?.hide();
          else if (objectProperties?.isOpen()) objectProperties.show(payload);
        },
        onSelectionOperationComplete: (payload) => selectionOperationStatus.complete(payload),
        onSelectionOperationProgress: (payload) => selectionOperationStatus.progress(payload),
        resolveTechnicalPropertyAccess: (objectId) => model.technicalPropertyAccessFor(objectId),
      },
    );
    const viewSession = createViewerSessionController({
      viewer: runtime.viewer,
      model,
      camera,
      selection,
      orbitPivot,
      visibility,
      appearance,
      getLoadedModels: () => model.listDescriptors(),
      readGraphicsState: () => ({ appearance: appearance.state() }),
      isCoarsePointer: () => (
        typeof window.matchMedia === "function"
          ? window.matchMedia("(pointer: coarse)").matches === true
          : Number(window.navigator?.maxTouchPoints || 0) > 0
      ),
    });
    resources = {
      runtime,
      model,
      camera,
      orbitPivot,
      appearance,
      spatial,
      selection,
      visibility,
      snapshot,
      measurement,
      labels,
      objectProperties,
      tree,
      identifiers,
      viewSession,
    };
    settleRuntime.resolve(resources);
    if (import.meta.env.VITE_BROWSER_CANARY === "true") {
      const firstObjectIdentifierForModel = (modelVersionId) => {
        const prefix = `${String(modelVersionId || "")}#`;
        return runtime.viewer.scene.objectIds.find((identifier) => String(identifier).startsWith(prefix)) || "";
      };
      const openContextMenuForIdentifier = (identifier) => {
        if (!identifier) return "";
        const modelVersionId = String(identifier).split("#", 1)[0];
        selection.select([identifier]);
        return createPublicSelectionPayload({ identifiers: [identifier], modelVersionId }).then((publicPayload) => {
          bridge?.post("selection.context-menu", {
            ...publicPayload,
            anchor: { x: 0.5, y: 0.5 },
          });
          return identifiers.tokenForObjectId(identifier);
        });
      };
      window.__bimCanaryPickFirstObject = () => {
        const identifier = runtime.viewer.scene.objectIds[0];
        if (!identifier) return "";
        const modelVersionId = String(identifier).split("#", 1)[0];
        selection.select([identifier]);
        return publishSelection({ identifiers: [identifier], modelVersionId })
          .then(() => identifiers.tokenForObjectId(identifier));
      };
      window.__bimCanaryOpenContextMenuFirstObject = () => {
        return openContextMenuForIdentifier(runtime.viewer.scene.objectIds[0]);
      };
      window.__bimCanaryHasModelObject = (modelVersionId) => Boolean(firstObjectIdentifierForModel(modelVersionId));
      window.__bimCanaryOpenContextMenuFirstObjectForModel = (modelVersionId) => (
        openContextMenuForIdentifier(firstObjectIdentifierForModel(modelVersionId))
      );
      window.__bimCanaryRuntimeSnapshot = () => {
        const canvas = runtime.viewer.scene.canvas.canvas;
        return {
          aabb: runtime.viewer.scene.getAABB(),
          modelCount: Object.keys(runtime.viewer.scene.models || {}).length,
          objectCount: Object.keys(runtime.viewer.scene.objects || {}).length,
          visibleObjectCount: Object.values(runtime.viewer.scene.objects || {})
            .filter((object) => object?.visible !== false).length,
          camera: {
            eye: [...runtime.viewer.camera.eye],
            look: [...runtime.viewer.camera.look],
            projection: runtime.viewer.camera.projection,
            up: [...runtime.viewer.camera.up],
          },
          canvas: {
            clientHeight: canvas.clientHeight,
            clientWidth: canvas.clientWidth,
            height: canvas.height,
            width: canvas.width,
          },
        };
      };
      window.__bimCanaryBusinessAppearanceSnapshot = (modelVersionId, globalIds = []) => {
        const normalizedModelId = String(modelVersionId || "");
        const colorizedObjectIds = new Set(runtime.viewer.scene.colorizedObjectIds || []);
        const requestedGlobalIds = Array.from(new Set(
          (Array.isArray(globalIds) ? globalIds : [])
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        )).slice(0, 256);
        const rows = requestedGlobalIds.map((globalId) => {
          const entity = runtime.viewer.scene.objects?.[`${normalizedModelId}#${globalId}`];
          const colorize = Array.isArray(entity?.colorize) || ArrayBuffer.isView(entity?.colorize)
            ? Array.from(entity.colorize).slice(0, 3).map((value) => Number(value))
            : null;
          return {
            globalId,
            exists: Boolean(entity),
            colorized: colorizedObjectIds.has(`${normalizedModelId}#${globalId}`),
            colorize,
          };
        });
        return {
          modelVersionId: normalizedModelId,
          requestedCount: rows.length,
          existingCount: rows.filter(({ exists }) => exists).length,
          colorizedCount: rows.filter(({ colorized }) => colorized).length,
          rows,
        };
      };
    }
    showStatus("loading", statusCopy.awaitingModel.heading, statusCopy.awaitingModel.message, 0);

    window.addEventListener("beforeunload", () => {
      bridge.destroy();
      selection.destroy();
      orbitPivot.destroy();
      measurement.destroy();
      labels.destroy();
      objectProperties.destroy();
      tree.destroy();
      selectionOperationStatus.destroy();
      visibility.destroy();
      spatial.destroy();
      model.destroy();
      runtime.destroy();
      identifiers.clear();
      delete window.__bimCanaryPickFirstObject;
      delete window.__bimCanaryOpenContextMenuFirstObject;
      delete window.__bimCanaryHasModelObject;
      delete window.__bimCanaryOpenContextMenuFirstObjectForModel;
      delete window.__bimCanaryRuntimeSnapshot;
      delete window.__bimCanaryBusinessAppearanceSnapshot;
    }, { once: true });
  } catch (error) {
    settleRuntime.reject(error);
    showStatus("error", statusCopy.unavailable.heading, String(error?.message || error), 0);
  }
}

void bootstrap();
