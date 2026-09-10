// SPDX-License-Identifier: AGPL-3.0-only
import { NavCubePlugin, Viewer, XKTDefaultDataSource, XKTLoaderPlugin } from "@xeokit/xeokit-sdk";

const CONTEXT_RESTORE_TIMEOUT_MS = 5_000;

export function configureSelectionPresentation(viewer) {
  const material = viewer?.scene?.selectedMaterial;
  if (!material) return;
  // The object's base material is dimmed separately; keep this overlay light enough
  // to identify the selection without concealing the geometry behind it.
  material.fill = true;
  material.fillAlpha = 0.25;
  material.edges = true;
  material.edgeAlpha = 1;
  material.edgeWidth = Math.max(Number(material.edgeWidth) || 0, 2);
}

export function createViewportRuntime({
  canvas,
  navCubeCanvas,
  onContextLost,
  onContextRestored,
  onContextRestoreFailed,
}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("A canvas element is required.");

  let viewer;
  try {
    viewer = new Viewer({
      canvasElement: canvas,
      spinnerElementId: "xeokit-spinner",
      transparent: false,
      antialias: true,
      saoEnabled: false,
      // Matches the reviewed host Viewer configuration: DTX can report a loaded
      // model while leaving some WebGL environments with a blank canvas.
      dtxEnabled: false,
      backgroundColor: [0.957, 0.937, 0.902],
      premultipliedAlpha: false,
    });
  } catch (cause) {
    const error = new Error("Viewer graphics runtime is unavailable.", { cause });
    error.protocolCode = "VIEWER_RUNTIME_UNAVAILABLE";
    error.recoverable = false;
    error.recoveryAction = "check_browser_graphics";
    throw error;
  }
  viewer.cameraControl.navMode = "orbit";
  viewer.cameraControl.followPointer = true;
  viewer.cameraFlight.duration = 0.7;
  viewer.cameraFlight.fit = true;
  configureSelectionPresentation(viewer);

  const loader = new XKTLoaderPlugin(viewer, {
    dataSource: new XKTDefaultDataSource({ cacheBuster: false }),
  });
  let navCube = null;
  if (navCubeCanvas instanceof HTMLCanvasElement) {
    try {
      navCube = new NavCubePlugin(viewer, {
        canvasId: navCubeCanvas.id,
        canvasElement: navCubeCanvas,
        visible: true,
        cameraFly: true,
        cameraFitFOV: 45,
        cameraFlyDuration: 0.8,
        color: "#e5e7eb",
        frontColor: "#d1d5db",
        backColor: "#d1d5db",
        leftColor: "#d1d5db",
        rightColor: "#d1d5db",
        topColor: "#d1d5db",
        bottomColor: "#d1d5db",
        hoverColor: "#38bdf8",
      });
    } catch (error) {
      // Camera navigation remains available even when a browser cannot create the helper canvas.
      console.warn("BIM navigation cube is unavailable.", error);
    }
  }
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  const contextLossExtension = gl?.getExtension("WEBGL_lose_context") || null;
  let restoreTimeout = null;
  const contextLost = (event) => {
    event.preventDefault();
    onContextLost?.();
  };
  const contextRestored = () => {
    window.clearTimeout(restoreTimeout);
    restoreTimeout = null;
    onContextRestored?.();
  };
  canvas.addEventListener("webglcontextlost", contextLost, false);
  canvas.addEventListener("webglcontextrestored", contextRestored, false);

  return Object.freeze({
    viewer,
    loader,
    requestContextRestore() {
      if (!contextLossExtension?.restoreContext) {
        onContextRestoreFailed?.("WebGL context restore is unavailable.");
        return false;
      }
      window.clearTimeout(restoreTimeout);
      restoreTimeout = window.setTimeout(() => {
        restoreTimeout = null;
        onContextRestoreFailed?.("WebGL context restore timed out.");
      }, CONTEXT_RESTORE_TIMEOUT_MS);
      contextLossExtension.restoreContext();
      return true;
    },
    destroy() {
      window.clearTimeout(restoreTimeout);
      canvas.removeEventListener("webglcontextlost", contextLost, false);
      canvas.removeEventListener("webglcontextrestored", contextRestored, false);
      try { navCube?.destroy?.(); } catch {}
      viewer.destroy();
    },
  });
}
