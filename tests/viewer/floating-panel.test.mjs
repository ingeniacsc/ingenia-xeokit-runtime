import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const helperUrl = new URL('../../packages/viewer/src/xeokit/floating-panel.js', import.meta.url);
const treeUrl = new URL('../../packages/viewer/src/xeokit/tree.js', import.meta.url);
const propertiesUrl = new URL('../../packages/viewer/src/xeokit/properties-panel.js', import.meta.url);
const stylesUrl = new URL('../../packages/viewer/src/styles.css', import.meta.url);

test('iframe panels share an oat surface and bounded drag and resize affordances', async () => {
  const [helper, tree, properties, styles] = await Promise.all([
    readFile(helperUrl, 'utf8'),
    readFile(treeUrl, 'utf8'),
    readFile(propertiesUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(helper, /export function makeViewportPanelDraggable/);
  assert.match(helper, /BOUNDARY_INSET_PX = 8/);
  assert.match(helper, /pointerdown/);
  assert.match(helper, /ResizeObserver/);
  assert.match(helper, /resizeHandle/);
  assert.match(helper, /minimumWidth = 256/);
  assert.match(tree, /makeViewportPanelDraggable\(panel, \{[\s\S]*?resizeHandle,[\s\S]*?\}\)/);
  assert.match(tree, /window\.requestAnimationFrame\(panelDrag\.clampToBounds\)/);
  assert.match(tree, /ingenia-panel-resize-handle/);
  assert.match(properties, /makeViewportPanelDraggable\(panel, \{[\s\S]*?resizeHandle,[\s\S]*?\}\)/);
  assert.match(properties, /window\.requestAnimationFrame\(panelDrag\.clampToBounds\)/);
  assert.match(properties, /ingenia-panel-resize-handle/);
  assert.match(styles, /--ingeniaViewerOverlayText: #424a4c/);
  assert.match(styles, /--ingeniaViewerPanelTitleSize: \.78rem/);
  assert.match(styles, /--ingeniaViewerPanelBodySize: \.8rem/);
  assert.match(styles, /\.ingenia-model-tree-body li\s*\{[\s\S]*?font-size: var\(--ingeniaViewerPanelBodySize\)/);
  assert.match(styles, /\.ingenia-properties-row\s*\{[\s\S]*?font-size: var\(--ingeniaViewerPanelTitleSize\)/);
  assert.match(styles, /\.ingenia-viewport-panel\s*\{[\s\S]*?rgba\(244, 239, 230, \.95\)/);
  assert.match(tree, /ingenia-model-tree ingenia-viewport-panel/);
  assert.match(properties, /ingenia-object-properties ingenia-viewport-panel/);
  assert.match(styles, /\.ingenia-panel-drag-handle/);
  assert.match(styles, /\.ingenia-panel-drag-handle::before/);
  assert.match(styles, /width: \.46rem/);
  assert.match(styles, /height: \.78rem/);
  assert.match(styles, /radial-gradient\(circle at \.07rem \.07rem/);
  assert.match(tree, /data-ingenia-panel-grip", "six-dot"/);
  assert.match(properties, /data-ingenia-panel-grip", "six-dot"/);
  assert.doesNotMatch(tree, /dragHandle\.textContent = "::"/);
  assert.doesNotMatch(properties, /dragHandle\.textContent = "::"/);
  assert.match(styles, /\.ingenia-panel-resize-handle/);
});
