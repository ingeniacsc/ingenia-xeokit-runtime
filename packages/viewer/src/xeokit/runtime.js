// SPDX-License-Identifier: AGPL-3.0-only
import { Viewer, XKTDefaultDataSource, XKTLoaderPlugin } from "@xeokit/xeokit-sdk";

const CONTEXT_RESTORE_TIMEOUT_MS = 5_000;

export function createViewportRuntime({
  canvas,
  onContextLost,
  onContextRestored,
  onContextRestoreFailed,
}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("A canvas element is required.");

  const viewer = new Viewer({
    canvasElement: canvas,
    spinnerElementId: "xeokit-spinner",
    transparent: false,
    antialias: true,
    saoEnabled: false,
    dtxEnabled: true,
    backgroundColor: [0.031, 0.184, 0.208],
    premultipliedAlpha: false,
  });
  viewer.cameraControl.navMode = "orbit";
  viewer.cameraControl.followPointer = true;
  viewer.cameraFlight.duration = 0.7;
  viewer.cameraFlight.fit = true;

  const loader = new XKTLoaderPlugin(viewer, {
    dataSource: new XKTDefaultDataSource({ cacheBuster: false }),
  });
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
      viewer.destroy();
    },
  });
}
