import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVersionObjects } from '../../packages/viewer/src/xeokit/version-selection.js';
import { createSelectionController } from '../../packages/viewer/src/xeokit/selection.js';
import { createProtocolEnvelope, validateProtocolEnvelope } from '../../packages/protocol/src/index.js';
const A = 'version.0000000001', B = 'version.0000000002';
function fixture(publish = () => ({})) {
  const selected = new Set(); const fit = [];
  const viewer = { scene: { objects: { [`${A}#same`]: {}, [`${B}#same`]: {} },
    canvas: { canvas: { addEventListener() {}, removeEventListener() {} } },
    get selectedObjectIds() { return [...selected]; },
    setObjectsSelected(ids, value) { ids.forEach((id) => value ? selected.add(id) : selected.delete(id)); },
  } };
  const model = { list: () => [A,B], modelVersionIdFor: (id) => id.split('#')[0], isObjectAllowed: () => true };
  const selection = createSelectionController(viewer, publish);
  return { viewer, model, selection, camera: { fit: (ids) => fit.push(ids) }, fit };
}
test('same GUID selects only the explicitly attributed version after authorization', async () => {
  const authorized = []; const f = fixture((p) => { authorized.push(p); return {}; });
  await selectVersionObjects(f, { modelId: B, globalIds: ['same'], fit: true });
  assert.deepEqual(f.viewer.scene.selectedObjectIds, [`${B}#same`]);
  assert.deepEqual(authorized[0].identifiers, [`${B}#same`]); assert.equal(f.fit.length,1);
});
for (const kind of ['absent','unloaded','denied','attribution']) test(`reject ${kind} without selecting another revision`, async () => {
  const f = fixture();
  if(kind === 'absent') delete f.viewer.scene.objects[`${A}#same`];
  if(kind === 'unloaded') f.model.list = () => [B];
  if(kind === 'denied') f.model.isObjectAllowed = () => false;
  if(kind === 'attribution') f.model.modelVersionIdFor = () => B;
  await assert.rejects(selectVersionObjects(f,{modelId:A,globalIds:['same']}));
  assert.deepEqual(f.viewer.scene.selectedObjectIds,[]);
});
for (const action of ['clear','newSelection','invalidate']) test(`pending authorization cancelled by ${action}`, async () => {
  let finish; const f=fixture(() => new Promise((resolve) => { finish=resolve; }));
  const pending=selectVersionObjects(f,{modelId:A,globalIds:['same'],fit:true});
  if(action==='clear') f.selection.clear();
  if(action==='newSelection') f.selection.select([`${B}#same`]);
  if(action==='invalidate') f.selection.invalidateModel(A);
  finish({}); await assert.rejects(pending,/cancelled/); assert.equal(f.fit.length,0);
  assert.deepEqual(f.viewer.scene.selectedObjectIds,action==='newSelection'?[`${B}#same`]:[]);
});
test('denied reference response does not accept an identical old selection', async () => {
 const f=fixture(() => null); f.selection.select([`${A}#same`]);
 await assert.rejects(selectVersionObjects(f,{modelId:A,globalIds:['same'],fit:true})); assert.equal(f.fit.length,0);
});
test('network authorization failure never applies selection', async () => {
 const f=fixture(async()=>{throw Error('denied');});
 await assert.rejects(selectVersionObjects(f,{modelId:A,globalIds:['same']}));
 assert.deepEqual(f.viewer.scene.selectedObjectIds,[]);
});
test('protocol validates bounded version payload, direction and namespace', () => {
 const envelope=(payload,source='host')=>createProtocolEnvelope({sessionId:'session.1234567890',nonce:'nonce.123456789012',source,stateRevision:1,type:'selection.by-global-ids',payload});
 assert.equal(validateProtocolEnvelope(envelope({modelId:A,globalIds:['same']})).ok,true);
 for(const payload of [{modelId:A,globalIds:[]},{modelId:A,globalIds:['same','same']},{modelId:A,globalIds:['other#same']},{modelId:A,globalIds:Array.from({length:51},(_,i)=>`id${i}`)},{modelId:A,globalIds:['same'],token:'secret'},{modelId:'short',globalIds:['same']}]) assert.equal(validateProtocolEnvelope(envelope(payload)).ok,false);
 assert.equal(validateProtocolEnvelope(envelope({modelId:A,globalIds:['same']},'viewer')).ok,false);
});
