import test from 'node:test';
import assert from 'node:assert/strict';

import { createSelectionOperationStatus } from '../../packages/viewer/src/xeokit/selection-operation-status.js';

function createTimers() {
  const callbacks = [];
  return {
    clearTimeout(id) { callbacks[id] = null; },
    setTimeout(callback) { callbacks.push(callback); return callbacks.length - 1; },
    run(id) { callbacks[id]?.(); },
  };
}

test('selection operation status reports local progress and the final visible selection count', () => {
  const container = { hidden: true, textContent: '' };
  const timers = createTimers();
  const status = createSelectionOperationStatus({ container, locale: 'vi', timers });

  status.progress({ scope: 'storey', processed: 125, total: 240, matched: 80 });
  assert.equal(container.hidden, false);
  assert.match(container.textContent, /125\/240/);
  assert.match(container.textContent, /80/);

  status.complete({ scope: 'storey', selectedCount: 80 });
  assert.equal(container.textContent, 'Đã chọn 80 cấu kiện cùng tầng đang hiển thị.');
  timers.run(0);
  assert.equal(container.hidden, true);
});
