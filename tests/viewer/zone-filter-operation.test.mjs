import test from "node:test";
import assert from "node:assert/strict";
import { createZoneFilterOperation } from "../../packages/viewer/src/xeokit/zone-filter-operation.js";
import { createSelectionReferencePages } from "../../packages/viewer/src/xeokit/selection-reference-pages.js";

function fixture(count = 12, options = {}) {
  const ids = Array.from({ length: count }, (_, i) => `version-a#${i}`);
  ids.push("version-b#0", "denied#0");
  const objects = Object.fromEntries(ids.map((id) => [id, { visible: id !== "denied#0", selected: false }]));
  const calls = [], progress = [], publications = [];
  const scene = {
    objects, get objectIds() { return Object.keys(objects); },
    get selectedObjectIds() { return Object.keys(objects).filter((id) => objects[id].selected); },
    setObjectsVisible(batch, value) { calls.push(batch.length); batch.forEach((id) => { objects[id].visible = value; }); },
    setObjectsSelected(batch, value) { calls.push(batch.length); batch.forEach((id) => { objects[id].selected = value; }); },
    getAABB() { return [0, 0, 0, 1, 1, 1]; }, render() {},
  };
  const viewer = { scene, cameraFlight: { flyTo() {} } };
  const operation = createZoneFilterOperation(viewer, {
    filterAllowedObjectIds: (values) => values.filter((id) => id !== "denied#0"),
    onSelect: (...args) => publications.push(args), onProgress: (value) => progress.push(value),
    yieldFrame: async () => {}, ...options,
  });
  return { operation, scene, ids, calls, progress, publications,
    visible: () => Object.keys(objects).filter((id) => objects[id].visible) };
}

test("14001 members are selected locally in bounded batches with only one protocol seed", async () => {
  const f = fixture(14001);
  const target = f.ids.slice(0, 14001);
  assert.equal(await f.operation.run([...target, "denied#0", "missing#0"]), true);
  assert.deepEqual(f.visible(), target);
  assert.deepEqual(f.scene.selectedObjectIds, target);
  assert.ok(Math.max(...f.calls) <= 256);
  assert.ok(f.progress.filter((p) => p.phase === "apply").length > 50);
  assert.deepEqual(f.publications[0][0], { identifiers: [target[0]], modelVersionId: "version-a" });
  assert.equal(f.publications[0][1](), true);
  assert.equal(f.progress.at(-1).total, 14001);
  await f.operation.run([], { reset: true });
  assert.equal(f.visible().length, 14002);
  assert.deepEqual(f.scene.selectedObjectIds, []);
  assert.equal(f.scene.objects["denied#0"].visible, false);
  assert.equal(f.publications[0][1](), false);
});

test("GUID export sees every completed zone member and rejects partial/stale selection", async () => {
  const f = fixture(14001);
  let referenceIndex = 0;
  const pages = createSelectionReferencePages({
    getObjectIds: () => f.operation.isBusy() ? [] : f.scene.selectedObjectIds,
    getRevision: () => `selection:${f.operation.getRevision()}`,
    modelVersionIdFor: () => "model-version-0000000001",
    isObjectAllowed: (id) => id !== "denied#0",
    createReferences: async (ids) => ids.map(() => `selection.session.reference-${String(++referenceIndex).padStart(16, '0')}`),
    createSnapshotId: () => "snapshot-0000000000001",
  });
  const pending = f.operation.run(f.ids.slice(0, 14001));
  await assert.rejects(pages.request({ offset: 0 }), /Select objects/);
  await pending;
  let page = await pages.request({ offset: 0 }), count = page.identifiers.length;
  while (!page.done) {
    page = await pages.request({ offset: count, snapshotId: page.snapshotId });
    count += page.identifiers.length;
  }
  assert.equal(count, 14001);
  assert.equal(page.total, 14001);
  const snapshotId = page.snapshotId;
  await f.operation.run(["version-b#0"]);
  await assert.rejects(pages.request({ offset: count, snapshotId }), /changed|expired/);
});

test("cancel restores prior visibility and selection without publishing an incomplete filter", async () => {
  let frames = 0, f;
  f = fixture(700, { yieldFrame: async () => { if (++frames === 4) f.operation.cancel(); } });
  f.scene.objects["version-a#0"].selected = true;
  const before = f.visible();
  assert.equal(await f.operation.run(f.ids.slice(0, 600)), false);
  assert.deepEqual(f.visible(), before);
  assert.deepEqual(f.scene.selectedObjectIds, ["version-a#0"]);
  assert.equal(f.publications.length, 0);
  assert.equal(f.progress.at(-1).phase, "cancelled");
});

test("replacing a running filter serializes rollback before the new selection", async () => {
  let frames = 0, f, replacement;
  f = fixture(700, { yieldFrame: async () => {
    if (++frames === 2) replacement = f.operation.run(["version-b#0"]);
  } });
  assert.equal(await f.operation.run(f.ids.slice(0, 600)), false);
  assert.equal(await replacement, true);
  assert.deepEqual(f.visible(), ["version-b#0"]);
  assert.deepEqual(f.scene.selectedObjectIds, ["version-b#0"]);
  assert.equal(f.publications.length, 1);
});

test("model removal and revoked rights during cancellation cannot restore forbidden objects", async () => {
  let frames = 0, f;
  const denied = new Set(["denied#0"]);
  f = fixture(700, {
    filterAllowedObjectIds: (ids) => ids.filter((id) => !denied.has(id)),
    yieldFrame: async () => {
      if (++frames === 2) {
        delete f.scene.objects["version-a#0"];
        denied.add("version-a#1");
        f.operation.cancel();
      }
    },
  });
  assert.equal(await f.operation.run(f.ids), false);
  assert.equal(f.scene.objects["version-a#0"], undefined);
  assert.equal(f.scene.objects["version-a#1"].visible, false);
  assert.equal(f.publications.length, 0);
});

test("destroy cancels active and queued work", async () => {
  let frames = 0, f;
  f = fixture(700, { yieldFrame: async () => { if (++frames === 2) f.operation.destroy(); } });
  assert.equal(await f.operation.run(f.ids), false);
  assert.equal(await f.operation.run(f.ids), false);
  assert.equal(f.publications.length, 0);
});

test("cancelling after model addition preserves newly loaded objects", async () => {
  let frames = 0, f;
  f = fixture(700, { yieldFrame: async () => {
    if (++frames === 2) {
      f.scene.objects["new-model#0"] = { visible: true, selected: false };
      f.operation.cancel();
    }
  } });
  const pending = f.operation.run(f.ids);
  assert.equal(f.operation.isBusy(), true);
  assert.equal(await pending, false);
  assert.equal(f.operation.isBusy(), false);
  assert.equal(f.scene.objects["new-model#0"].visible, true);
});

test("authority renewal cancels filtering without restoring stale selection even when geometry stays allowed", async () => {
  let frames = 0, f;
  f = fixture(700, { yieldFrame: async () => {
    if (++frames === 4) {
      f.operation.cancel({ discardSelection: true });
      f.scene.setObjectsSelected(f.scene.selectedObjectIds, false);
    }
  } });
  f.scene.objects["version-a#0"].selected = true;
  const before = f.visible();
  assert.equal(await f.operation.run(f.ids.slice(0, 600)), false);
  assert.deepEqual(f.visible(), before);
  assert.deepEqual(f.scene.selectedObjectIds, []);
  assert.equal(f.publications.length, 0);
});

test("authority revocation during selection restoration stops every remaining restore batch", async () => {
  let frames = 0, f;
  f = fixture(700, { yieldFrame: async () => {
    frames += 1;
    if (frames === 1) f.operation.cancel();
    if (frames === 8) {
      f.operation.cancel({ discardSelection: true });
      f.scene.setObjectsSelected(f.scene.selectedObjectIds, false);
    }
  } });
  f.scene.setObjectsSelected(f.ids.slice(0, 700), true);
  assert.equal(await f.operation.run(f.ids), false);
  assert.ok(frames >= 8);
  assert.deepEqual(f.scene.selectedObjectIds, []);
  assert.equal(f.publications.length, 0);
});

test("failed filter restores previous scene", async () => {
  let frames = 0;
  const f = fixture(700, { yieldFrame: async () => { if (++frames === 2) throw new Error("test failure"); } });
  const before = f.visible();
  await assert.rejects(f.operation.run(f.ids), /test failure/);
  assert.deepEqual(f.visible(), before);
  assert.equal(f.progress.at(-1).phase, "error");
});
