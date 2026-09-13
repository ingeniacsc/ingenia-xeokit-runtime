import test from 'node:test';
import assert from 'node:assert/strict';
import {createTreeNodeComparator, resolveModelStoreys} from '../../packages/viewer/src/xeokit/tree-hierarchy.js';

function fixture(rows) {
  const metaObjects = Object.fromEntries(rows.map(([id, name, elevation]) => [id,
    {id, name, type:'IfcBuildingStorey', attributes:{elevation}}]));
  const viewer = {metaScene:{metaObjects, metaModels:{m:{finalized:true, metaObjects}}}};
  const nodes = rows.map(([id, name]) => ({objectId:id, title:name, type:'IfcBuildingStorey'}));
  return {viewer, nodes};
}

test('model-tree and storey tab order by explicit elevation from basement to roof', () => {
  const {viewer,nodes} = fixture([
    ['11','LEVEL 11',33], ['b1','BASEMENT B1',-3], ['2','LEVEL 2',6],
    ['b2','BASEMENT B2',-6], ['1','LEVEL 1',0],
  ]);
  const expected = ['b2','b1','1','2','11'];
  assert.deepEqual(nodes.sort(createTreeNodeComparator(viewer)).map(n=>n.objectId), expected);
  assert.deepEqual(resolveModelStoreys(viewer,[{modelId:'m'}]).map(n=>n.objectId), expected);
});

test('unknown heights remain unknown and use natural name order after known levels', () => {
  const {viewer,nodes} = fixture([
    ['11','LEVEL 11',null], ['2','LEVEL 2',''], ['0','GROUND','0'],
    ['12b','LEVEL 12B',false], ['12a','LEVEL 12A','invalid'], ['1','LEVEL 1',undefined],
  ]);
  assert.deepEqual(nodes.sort(createTreeNodeComparator(viewer)).map(n=>n.objectId), ['0','1','2','11','12a','12b']);
  assert.equal(resolveModelStoreys(viewer,[{modelId:'m'}]).find(n=>n.objectId==='11').elevation, null);
});

test('equal elevations use natural names without changing identifiers or source order', () => {
  const {viewer,nodes} = fixture([['11','LEVEL 11',3],['2','LEVEL 2',3]]);
  const before = JSON.stringify(viewer);
  assert.deepEqual([...nodes].sort(createTreeNodeComparator(viewer)).map(n=>n.objectId), ['2','11']);
  assert.equal(JSON.stringify(viewer), before);
});
