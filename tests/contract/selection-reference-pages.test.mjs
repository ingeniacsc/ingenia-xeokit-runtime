import test from 'node:test';
import assert from 'node:assert/strict';
import {createProtocolEnvelope,validateProtocolEnvelope} from '../../packages/protocol/src/index.js';
const make = (type,payload) => createProtocolEnvelope({sessionId:'session.1234567890',nonce:'nonce.123456789012',stateRevision:1,source:type.endsWith('request')?'host':'viewer',type,payload});
const base={requestId:'request.123456789012',snapshotId:'snapshot.1234567890',modelVersionId:'model.123456789012',offset:0,total:1,done:true,identifiers:['selection.session.abcdefghijklmnopqrstuvwx']};
test('export pages accept bounded opaque references and terminal revalidation',()=>{
 assert.equal(validateProtocolEnvelope(make('selection.references.request',{offset:0})).ok,true);
 assert.equal(validateProtocolEnvelope(make('selection.references.result',base)).ok,true);
 assert.equal(validateProtocolEnvelope(make('selection.references.result',{...base,offset:1,identifiers:[]})).ok,true);
});
test('export rejects raw GUID, extra metadata, duplicate references and inconsistent counts',()=>{
 for(const payload of [{...base,identifiers:['0123456789012345678901']},{...base,globalId:'0123456789012345678901'},{...base,done:false},{...base,total:2},{...base,offset:-1},{...base,total:2,identifiers:[base.identifiers[0],base.identifiers[0]]},{...base,total:51,identifiers:Array.from({length:51},(_,i)=>'selection.session.'+String(i).padStart(24,'a'))}]) assert.equal(validateProtocolEnvelope(make('selection.references.result',payload)).ok,false);
 for(const payload of [{offset:1},{offset:0,accessToken:'secret'},{offset:0,snapshotId:'short'}]) assert.equal(validateProtocolEnvelope(make('selection.references.request',payload)).ok,false);
});
