import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createModelController } from "../../packages/viewer/src/xeokit/model.js";

async function fixture(t, initialScope = { mode: "allowlist", allowedObjectIds: ["a", "b"] }) {
  const originalFetch = globalThis.fetch;
  const originalFrame = globalThis.requestAnimationFrame;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.requestAnimationFrame = originalFrame; });
  const content = new Uint8Array([13, 21, 34, 55]).buffer;
  const requests = [];
  const callbacks = {};
  let loads = 0;
  let destroyed = 0;
  let authorityChanges = 0;
  let detailsOpen = false;
  let scope = initialScope;
  let scopeStatus = 200;
  const scene = {
    objects: {}, render() {},
    setObjectsVisible(ids, visible) { ids.forEach((id) => { this.objects[id].visible = visible; }); },
  };
  const camera = { eye: [3, 4, 5], look: [0, 1, 0], projection: "ortho" };
  const controller = createModelController({
    onAuthorityChanged() {
      authorityChanges += 1;
      detailsOpen = false;
      Object.values(scene.objects).forEach((object) => { object.selected = false; });
    },
    viewer: { scene, camera, cameraFlight: { jumpTo() { assert.fail("Renewal must not fit camera"); } } },
    loader: { load() {
      loads += 1;
      for (const id of ["a", "b", "c"]) scene.objects[`m#${id}`] = { id: `m#${id}`, visible: true };
      return { numEntities: 3, on(name, fn) { callbacks[name] = fn; }, destroy() { destroyed += 1; } };
    } },
  });
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/scope")) return {
      ok: scopeStatus === 200, status: scopeStatus, headers: { get: () => null },
      text: async () => JSON.stringify({ schemaVersion: "viewer_geometry_scope.v1", modelVersionId: "m", geometryScope: scope }),
    };
    if (url.endsWith("/selection")) return { ok: true, json: async () => ({ references: ["selection-test-reference"] }) };
    return { ok: true, arrayBuffer: async () => content };
  };
  const descriptor = (generation) => ({
    modelId: "m", revision: 1, format: "xkt", preserveCamera: true,
    contentHash: createHash("sha256").update(Buffer.from(content)).digest("hex"),
    artifactUrl: "https://viewer.invalid/content", geometryScopeUrl: "https://viewer.invalid/scope",
    selectionReferenceUrl: "https://viewer.invalid/selection", capabilityId: `test-generation-${generation}`,
    requestHeaders: { "X-Artifact-Capability": `test-only-${String(generation).padStart(32, "0")}` },
  });
  const opening = controller.add(descriptor(0));
  const deadline = Date.now() + 2000;
  while (!callbacks.loaded && Date.now() < deadline) await new Promise(setImmediate);
  assert.equal(typeof callbacks.loaded, "function");
  callbacks.loaded();
  await opening;
  return { controller, descriptor, scene, camera, requests,
    setScope(next) { scope = next; }, deny() { scopeStatus = 404; },
    setStatus(value) { scopeStatus = value; },
    openDetails() { detailsOpen = true; },
    authorityState: () => ({ authorityChanges, detailsOpen }),
    counts: () => ({ loads, destroyed, geometryGets: requests.filter((r) => r.url.endsWith("/content")).length }),
  };
}

test("three credential rotations retain geometry, camera and manual hiding while selection uses fresh authority", async (t) => {
  const f = await fixture(t);
  f.scene.objects["m#a"].visible = false;
  f.scene.objects["m#b"].selected = true;
  const object = f.scene.objects["m#b"];
  const camera = structuredClone(f.camera);
  f.openDetails();
  for (let generation = 1; generation <= 3; generation += 1) {
    const descriptor = f.descriptor(generation);
    assert.deepEqual(await f.controller.add(descriptor), { modelId: "m", objectCount: 2 });
    assert.equal(f.scene.objects["m#a"].visible, false);
    assert.equal(f.scene.objects["m#b"], object);
    assert.equal(object.visible, true);
    assert.equal(object.selected, true);
    assert.equal(f.scene.objects["m#c"].visible, false);
    assert.deepEqual(f.camera, camera);
    assert.deepEqual(f.authorityState(), { authorityChanges: 0, detailsOpen: true });
    assert.equal(f.controller.capabilityIdFor("m#b"), descriptor.capabilityId);
    await f.controller.createSelectionReferences(["m#b"]);
    assert.equal(f.requests.at(-1).options.headers["X-Artifact-Capability"], descriptor.requestHeaders["X-Artifact-Capability"]);
  }
  assert.deepEqual(f.counts(), { loads: 1, destroyed: 0, geometryGets: 1 });
});

test("narrowing scope during renewal hides newly denied objects without revealing manually hidden objects", async (t) => {
  const f = await fixture(t, { mode: "all" });
  f.scene.objects["m#a"].visible = false;
  f.scene.objects["m#c"].selected = true;
  f.openDetails();
  f.setScope({ mode: "allowlist", allowedObjectIds: ["a", "b"] });
  await f.controller.add(f.descriptor(1));
  assert.equal(f.scene.objects["m#a"].visible, false);
  assert.equal(f.scene.objects["m#b"].visible, true);
  assert.equal(f.scene.objects["m#c"].visible, false);
  assert.equal(f.controller.isObjectAllowed("m#c"), false);
  assert.equal(f.scene.objects["m#c"].selected, false);
  assert.deepEqual(f.authorityState(), { authorityChanges: 1, detailsOpen: false });
  assert.deepEqual(f.controller.filterAllowedObjectIds(["m#a", "m#c"]), ["m#a"]);
});

test("broader renewed authority does not automatically reveal objects hidden in the current view", async (t) => {
  const f = await fixture(t);
  f.scene.objects["m#a"].visible = false;
  f.setScope({ mode: "allowlist", allowedObjectIds: ["a", "b", "c"] });
  await f.controller.add(f.descriptor(1));
  assert.equal(f.controller.isObjectAllowed("m#c"), true);
  assert.equal(f.scene.objects["m#a"].visible, false);
  assert.equal(f.scene.objects["m#c"].visible, false);
  f.setScope({ mode: "all" });
  await f.controller.add(f.descriptor(2));
  assert.equal(f.scene.objects["m#c"].visible, false);
});

test("rejected geometry authority never replaces the accepted credential or reloads geometry", async (t) => {
  const f = await fixture(t);
  f.deny();
  await assert.rejects(f.controller.add(f.descriptor(1)), /geometry scope request failed \(404\)/);
  assert.equal(f.controller.capabilityIdFor("m#b"), f.descriptor(0).capabilityId);
  assert.deepEqual(f.counts(), { loads: 1, destroyed: 0, geometryGets: 1 });
  // The rejected command is reported to the host, which owns fail-closed teardown.
});


test("technical access change invalidates selected details before ready but unchanged permission keeps them", async (t) => {
  const f = await fixture(t);
  const technicalPropertyAccess = Object.fromEntries(["objectName", "ifcType", "typeName", "globalId", "storey", "tag", "propertySets"].map((key) => [key, true]));
  await f.controller.add({ ...f.descriptor(1), technicalPropertyAccess });
  f.openDetails();
  f.scene.objects["m#b"].selected = true;
  const before = f.authorityState().authorityChanges;
  await f.controller.add({ ...f.descriptor(2), technicalPropertyAccess });
  assert.deepEqual(f.authorityState(), { authorityChanges: before, detailsOpen: true });
  await f.controller.add({ ...f.descriptor(3), technicalPropertyAccess: { ...technicalPropertyAccess, propertySets: false } });
  assert.deepEqual(f.authorityState(), { authorityChanges: before + 1, detailsOpen: false });
  assert.equal(f.scene.objects["m#b"].selected, false);
  assert.equal(f.controller.technicalPropertyAccessFor("m#b").propertySets, false);
});

test("known transient scope failures are distinguished from denied authority without leaking a fetch URL", async (t) => {
  const f = await fixture(t);
  const { classifyCommandFailure } = await import("../../packages/viewer/src/protocol-bridge/bridge.js");
  for (const status of [408, 429, 503]) {
    f.setStatus(status);
    await assert.rejects(f.controller.add(f.descriptor(1)), (error) => {
      assert.equal(classifyCommandFailure("model.add", error).code, "CAPABILITY_REFRESH_TRANSIENT");
      return true;
    });
  }
  for (const status of [401, 403, 404]) {
    f.setStatus(status);
    await assert.rejects(f.controller.add(f.descriptor(1)), (error) => {
      assert.notEqual(classifyCommandFailure("model.add", error).code, "CAPABILITY_REFRESH_TRANSIENT");
      return true;
    });
  }
  globalThis.fetch = async () => { throw new TypeError("private request detail must not be propagated"); };
  await assert.rejects(f.controller.add(f.descriptor(1)), (error) => {
    assert.equal(error.protocolCode, "CAPABILITY_REFRESH_TRANSIENT");
    assert.equal(error.message, "Model geometry scope is temporarily unavailable.");
    return true;
  });
  assert.equal(f.controller.capabilityIdFor("m#b"), f.descriptor(0).capabilityId);
});

test("a delayed superseded scope response cannot overwrite a newer accepted capability", async (t) => {
  const f = await fixture(t);
  const fetchScope = globalThis.fetch;
  let resolveOld;
  globalThis.fetch = (url, options) => {
    if (options.headers["X-Artifact-Capability"] === f.descriptor(1).requestHeaders["X-Artifact-Capability"]) {
      return new Promise((resolve) => { resolveOld = () => resolve(fetchScope(url, options)); });
    }
    return fetchScope(url, options);
  };
  const old = f.controller.add(f.descriptor(1));
  const rejection = assert.rejects(old, (error) => error.name === "AbortError");
  await f.controller.add(f.descriptor(2));
  resolveOld();
  await rejection;
  assert.equal(f.controller.capabilityIdFor("m#b"), f.descriptor(2).capabilityId);
  assert.deepEqual(f.counts(), { loads: 1, destroyed: 0, geometryGets: 1 });
});


test("a broken scope response body is transient but malformed authority is rejected", async (t) => {
  const f = await fixture(t);
  globalThis.fetch = async () => ({ok:true, headers:{get:()=>null}, text:async()=>{throw new TypeError("network body interrupted");}});
  await assert.rejects(f.controller.add(f.descriptor(1)), (error) => error.protocolCode === "CAPABILITY_REFRESH_TRANSIENT");
  globalThis.fetch = async () => ({ok:true, headers:{get:()=>null}, text:async()=>"invalid json"});
  await assert.rejects(f.controller.add(f.descriptor(1)), (error) => {
    assert.notEqual(error.protocolCode, "CAPABILITY_REFRESH_TRANSIENT");
    return /not valid JSON/.test(error.message);
  });
  assert.equal(f.controller.capabilityIdFor("m#b"), f.descriptor(0).capabilityId);
});
