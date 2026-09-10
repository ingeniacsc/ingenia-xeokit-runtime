import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const spatialUrl = new URL("../../packages/viewer/src/xeokit/spatial.js", import.meta.url);

test("section commands preserve the movable in-canvas control", async () => {
  const source = await readFile(spatialUrl, "utf8");

  assert.match(source, /active:\s*true/);
  assert.match(source, /sectionPlanes\.showControl\?\.\(plane\.id\)/);
  assert.match(source, /sectionPlanes\.hideControl\?\.\(\)/);
  assert.match(source, /createSectionAxisLabels/);
  assert.match(source, /axisLabels\.setSectionPlane\(plane\)/);
  assert.match(source, /axisLabels\.clear\(\)/);
  assert.match(source, /axisLabels\.destroy\(\)/);
  assert.match(source, /viewer\.scene\.render\(true\)/);
  assert.match(source, /buildIfcSpaceMembershipVolume/);
  assert.match(source, /classifyVisibleObjectsBySpaceMembership/);
  assert.match(source, /visibility\?\.hideTransient/);
  assert.match(source, /visibility\?\.restoreTransient/);
  assert.match(source, /SPACE_CLIP_FLOOR_ID/);
  assert.match(source, /SPACE_CLIP_CEILING_ID/);
});

test("level clipping resolves IFC storeys locally and uses two horizontal planes", async () => {
  const source = await readFile(spatialUrl, "utf8");

  assert.match(source, /IfcBuildingStorey/);
  assert.match(source, /explicitStoreyElevation/);
  assert.match(source, /minimumRenderedElevation/);
  assert.match(source, /const LEVEL_CLIP_PREFIX = "level-clip:"/);
  assert.match(source, /LEVEL_CLIP_FLOOR_ID/);
  assert.match(source, /LEVEL_CLIP_CEILING_ID/);
  assert.match(source, /const METRES_PER_MILLIMETRE = 0\.001/);
  assert.match(source, /normalizeLevelOffsetMm/);
  assert.match(source, /pos: \[0, lowerElevation, 0\], dir: \[0, 1, 0\]/);
  assert.match(source, /pos: \[0, upperElevation, 0\], dir: \[0, -1, 0\]/);
  assert.match(source, /requestLevelOptions\(\)/);
  assert.match(source, /setLevelClip\(\{ lowerLevelRef, upperLevelRef, lowerOffsetMm, upperOffsetMm \}/);
  assert.match(source, /lowerLevel\.elevation \+ normalizedLowerOffsetMm \* METRES_PER_MILLIMETRE/);
  assert.match(source, /upperLevel\.elevation \+ normalizedUpperOffsetMm \* METRES_PER_MILLIMETRE/);
});
