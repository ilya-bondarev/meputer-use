import test from 'node:test';
import assert from 'node:assert/strict';
import {readPage} from '../src/pages.mjs';

test('read-only page polling tolerates input in another window between observations',async()=>{
  let reads=0;
  const session={bind:async()=>{},document:async()=>({
    url:'https://example.org/',text:++reads===1?'Loading':'Ready for the next step',
    lastInputTick:reads,inputChangedDuringRead:false,
  })};
  const result=await readPage(session,{window:{id:1,processId:2},contains:'Ready'});
  assert.equal(result.taskStatus,'observed');
  assert.equal(reads,2);
});
