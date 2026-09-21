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

test("site context requires an explicit registered parcel elevation", async () => {
  const source = await readFile(spatialUrl, "utf8");

  assert.match(source, /const SITE_CONTEXT_PREFIX = "site-context:"/);
  assert.match(source, /function setSiteContext\(\{ site \} = \{\}\)/);
  assert.doesNotMatch(source, /site\?\.elevation \?\? 0/);
  const siteSource = source.slice(source.indexOf('function setSiteContext'), source.indexOf('function clearManualSection'));
  assert.match(siteSource, /diffuse: \[190 \/ 255, 151 \/ 255, 71 \/ 255\]/);
  assert.match(siteSource, /alpha: 0\.65/);
  assert.match(siteSource, /alphaMode: "blend"/);
  assert.match(siteSource, /pickable: false, collidable: false, clippable: false/);
  assert.match(source, /rawElevation === null \|\| rawElevation === undefined/);
  assert.match(source, /projectGridPoint\(\[point\?\.\[0\], point\?\.\[1\], elevation\]\)/);
  assert.match(source, /appendGridRibbon\(positions, indices, points\[index - 1\], points\[index\], ribbonWidth\)/);
  assert.match(source, /pickable: false, collidable: false, clippable: false/);
  assert.match(source, /clearSiteContext\(\)/);
});

test("project grids support elevation filtering and sticky on-screen axis labels", async () => {
  const source = await readFile(spatialUrl, "utf8");

  assert.match(source, /setProjectGrid\(\{ grid, levels = \[\], visibleElevations = \[\], stickyLabels = true \}/);
  assert.match(source, /selectedElevations\.some\(\(selected\) => Math\.abs\(selected - elevation\) <= 0\.001\)/);
  assert.match(source, /worldEnd: end/);
  assert.match(source, /Math\.min\(width - 18, Math\.max\(18, point\[0\]\)\)/);
  assert.match(source, /screenSide: "left"/);
  assert.match(source, /screenSide: "right"/);
  assert.match(source, /label: `Cao độ \$\{elevation\.toFixed\(3\)\} m`/);
  assert.match(source, /const registryLevels = normalizeProjectLevels\(levels\)/);
  assert.match(source, /const knownLevels = registryLevels\.length \? registryLevels : resolveStoreyLevels\(viewer\)/);
  assert.match(source, /label: matchedLevelLabel/);
  assert.match(source, /\.join\(" \/ "\)/);
});

test("grid-axis sections use an exact vertical plane through the IFC grid line", async () => {
  const source = await readFile(spatialUrl, "utf8");

  assert.match(source, /function resolveGridAxisSection\(gridAxis\)/);
  assert.match(source, /const start = projectGridPoint\(gridAxis\?\.start\)/);
  assert.match(source, /dir: \[-dz \/ length, 0, dx \/ length\]/);
  assert.match(source, /pos: gridAxisSection\?\.pos \|\| pos \|\| center/);
  assert.match(source, /dir: gridAxisSection\?\.dir \|\| dir/);
});
