// SPDX-License-Identifier: AGPL-3.0-only
import "./styles.css";
import { readBootstrapConfiguration, createViewerBridge } from "./protocol-bridge/bridge.js";
import { createModelController } from "./xeokit/model.js";
import { createCameraController } from "./xeokit/camera.js";
import { createSelectionController } from "./xeokit/selection.js";
import { createAppearanceController } from "./xeokit/appearance.js";
import { createVisibilityController } from "./xeokit/visibility.js";
import { createObjectIdentifierRegistry } from "./xeokit/object-identifiers.js";

const status = document.querySelector("#viewport-status");
const title = document.querySelector("#status-title");
const detail = document.querySelector("#status-detail");
const progress = document.querySelector("#status-progress");

function showStatus(tone, heading, message, percent = 0) {
  status.dataset.tone = tone;
  title.textContent = heading;
  detail.textContent = message;
  progress.value = Math.max(0, Math.min(100, percent));
}

async function bootstrap() {
  try {
    const bootstrap = readBootstrapConfiguration(
      window.location,
      import.meta.env.VITE_ALLOWED_PARENT_ORIGINS,
    );
    showStatus("loading", "Preparing BIM viewport", "Loading the reviewed graphics runtime.", 0);
    const [{ createViewportRuntime }, { createSpatialController }] = await Promise.all([
      import("./xeokit/runtime.js"),
      import("./xeokit/spatial.js"),
    ]);
    let bridge;
    const runtime = createViewportRuntime({
      canvas: document.querySelector("#xeokit-canvas"),
      onContextLost: () => {
        showStatus("error", "Graphics context interrupted", "Requesting a safe restore.");
        bridge?.post("context.lost", {});
      },
      onContextRestored: () => {
        showStatus("ready", "BIM viewport restored", "Graphics context is active again.", 100);
        bridge?.post("context.restored", {});
      },
      onContextRestoreFailed: (message) => {
        showStatus("error", "Graphics context unavailable", message);
        bridge?.post("context.restore-failed", {
          code: "WEBGL_CONTEXT_RESTORE_FAILED",
          message,
          recoverable: true,
          recoveryAction: "reload_iframe_cache_bust",
        });
      },
    });
    const model = createModelController({
      viewer: runtime.viewer,
      loader: runtime.loader,
      onProgress: ({ modelId, percent, phase }) => {
        showStatus(percent === 100 ? "ready" : "loading", "Loading BIM model", `${modelId}: ${phase}`, percent);
        bridge?.post("model.progress", { modelId, percent, phase });
      },
    });
    const camera = createCameraController(runtime.viewer);
    const appearance = createAppearanceController(runtime.viewer);
    const spatial = createSpatialController(runtime.viewer);
    const identifiers = createObjectIdentifierRegistry();
    const selection = createSelectionController(runtime.viewer, (payload) => {
      const publicPayload = { identifiers: payload.identifiers.map(identifiers.toToken) };
      bridge?.post("object.picked", publicPayload);
      bridge?.post("selection.changed", publicPayload);
    });
    const visibility = createVisibilityController(runtime.viewer);
    const publicHandlers = {
      camera: {
        fit: (tokens) => camera.fit(identifiers.toObjectIds(tokens)),
        set: camera.set,
        view: camera.view,
        navigation: camera.navigation,
      },
      selection: {
        select: (tokens) => selection.select(identifiers.toObjectIds(tokens)),
        clear: selection.clear,
      },
      visibility: {
        show: (tokens) => visibility.show(identifiers.toObjectIds(tokens)),
        hide: (tokens) => visibility.hide(identifiers.toObjectIds(tokens)),
        isolate: (tokens) => visibility.isolate(identifiers.toObjectIds(tokens)),
        reset: visibility.reset,
      },
      appearance: {
        apply: ({ identifiers: tokens = [], options = {} }) => appearance.apply({
          identifiers: tokens.length ? identifiers.toObjectIds(tokens) : [],
          options,
        }),
        dayNight: appearance.dayNight,
      },
    };

    bridge = createViewerBridge({
      parentWindow: window.parent,
      ...bootstrap,
      viewerBuild: String(import.meta.env.VITE_VIEWER_BUILD || "local-dev").padEnd(7, "0"),
      handlers: {
        model,
        camera: publicHandlers.camera,
        appearance: publicHandlers.appearance,
        spatial,
        selection: publicHandlers.selection,
        visibility: publicHandlers.visibility,
        reliability: { restoreContext: () => runtime.requestContextRestore() },
      },
    });
    if (import.meta.env.VITE_BROWSER_CANARY === "true") {
      window.__bimCanaryPickFirstObject = () => {
        const identifier = runtime.viewer.scene.objectIds[0];
        if (!identifier) return "";
        selection.select([identifier]);
        const token = identifiers.toToken(identifier);
        const payload = { identifiers: [token] };
        bridge.post("object.picked", payload);
        bridge.post("selection.changed", payload);
        return token;
      };
    }
    showStatus("loading", "Viewport ready", "Waiting for a model command.", 0);

    window.addEventListener("beforeunload", () => {
      bridge.destroy();
      selection.destroy();
      spatial.destroy();
      model.destroy();
      runtime.destroy();
      identifiers.clear();
      delete window.__bimCanaryPickFirstObject;
    }, { once: true });
  } catch (error) {
    showStatus("error", "Viewport unavailable", String(error?.message || error), 0);
  }
}

void bootstrap();
