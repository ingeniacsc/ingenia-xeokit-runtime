import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtimeUrl = new URL('../../packages/viewer/src/xeokit/runtime.js', import.meta.url);

test('selected objects retain their existing color with a translucent fill and clear edge', async () => {
  const source = await readFile(runtimeUrl, 'utf8');

  assert.match(source, /function configureSelectionPresentation\(viewer\)/);
  assert.match(source, /material\.fill = true/);
  assert.match(source, /material\.fillAlpha = 0\.25/);
  assert.match(source, /material\.edges = true/);
  assert.match(source, /material\.edgeAlpha = 1/);
  assert.match(source, /material\.edgeWidth = Math\.max\(Number\(material\.edgeWidth\) \|\| 0, 2\)/);
  assert.match(source, /viewer\.cameraFlight\.fit = true;\s+configureSelectionPresentation\(viewer\)/);
});
