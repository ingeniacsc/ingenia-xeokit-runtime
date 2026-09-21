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

test('storey labels with optional letter-number whitespace sort naturally without inferred elevations', () => {
  const {viewer,nodes} = fixture([
    ['33','LEVEL 33',null], ['10','LEVEL10',null], ['12b','LEVEL 12B',null],
    ['9','LEVEL 9',null], ['12a','LEVEL 12A',null], ['11','LEVEL 11',null],
  ]);
  const before = JSON.stringify(viewer);
  const expected = ['9','10','11','12a','12b','33'];
  assert.deepEqual([...nodes].sort(createTreeNodeComparator(viewer)).map(n=>n.objectId), expected);
  const storeys = resolveModelStoreys(viewer,[{modelId:'m'}]);
  assert.deepEqual(storeys.map(n=>n.objectId), expected);
  assert.deepEqual(storeys.map(n=>n.label), ['LEVEL 9','LEVEL10','LEVEL 11','LEVEL 12A','LEVEL 12B','LEVEL 33']);
  assert.ok(storeys.every(n=>n.elevation === null));
  assert.equal(JSON.stringify(viewer), before);
});

test('explicit elevations override normalized storey names and unknown levels remain last', () => {
  const {viewer,nodes} = fixture([
    ['9','LEVEL 9',30], ['10','LEVEL10',10], ['2','LEVEL 2',null], ['11','LEVEL 11',20],
  ]);
  const expected = ['10','11','9','2'];
  assert.deepEqual([...nodes].sort(createTreeNodeComparator(viewer)).map(n=>n.objectId), expected);
  assert.deepEqual(resolveModelStoreys(viewer,[{modelId:'m'}]).map(n=>n.objectId), expected);
});

test('equal sort keys do not merge different storey names or change non-storey ordering', () => {
  const {viewer,nodes} = fixture([['a','LEVEL 10',null],['b','LEVEL10',null]]);
  const storeys = resolveModelStoreys(viewer,[{modelId:'m'}]);
  assert.equal(storeys.length,2);
  assert.deepEqual(new Set(storeys.flatMap(n=>n.objectIds)),new Set(['a','b']));
  const natural = new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  const names = ['PART10','PART 33','PART 9','LEVEL-10','1 2','12'];
  const objects = names.map((title,index)=>({objectId:String(index),title,type:'IfcWall'}));
  assert.deepEqual(objects.sort(createTreeNodeComparator({})).map(n=>n.title), [...names].sort(natural.compare));
  assert.deepEqual([...nodes].sort(createTreeNodeComparator(viewer)).map(n=>n.title), ['LEVEL 10','LEVEL10'].sort(natural.compare));
});
