import assert from 'node:assert/strict';
import {createConnectors} from '../src/connectors.mjs';
import {read,route,validatePage} from '../src/services/metrika/index.mjs';

// Guard the service boundary and the SPA race: a new URL must not identify an old form.
const snapshot={truncated:false,inputChangedDuringRead:false,elements:[
  {role:'Document',value:'https://metrika.yandex.ru/settings?tab=common&id=123'},
  {role:'Text',name:'Номер 123'},
  {role:'Edit',name:'Имя счетчика',value:'Example'},
  {role:'Edit',name:'Домен или путь (без http, https и www)',value:'example.org'},
  {role:'Button',name:'Сохранить',enabled:false},
]};
const at=address=>({...snapshot,elements:[{...snapshot.elements[0],value:address},...snapshot.elements.slice(1)]});
for(const address of ['https://metrika.yandex.ru.evil.test/settings','http://metrika.yandex.ru/settings','https://user@metrika.yandex.ru/settings','https://passport.yandex.ru/','invalid']) {
  assert.throws(()=>validatePage({url:address}),{code:'CONNECTOR_PAGE_MISMATCH'});
}
assert.throws(()=>read('counter.info',at('https://metrika.yandex.ru/settings?tab=common&id=456')),{code:'COUNTER_ID_NOT_VERIFIED'});
assert.throws(()=>read('counter.info',at('https://metrika.yandex.ru/settings?tab=common&id=123&id=456')),{code:'COUNTER_ID_NOT_VERIFIED'});
assert.throws(()=>read('counter.info',{...snapshot,truncated:true}),{code:'INCOMPLETE_OBSERVATION'});
for(const args of [{page:'settings'},{page:'settings',counterId:'0'},{page:'settings',counterId:123},{page:'settings',counterId:'123&tab=other'},{page:'counters',counterId:'123'},{page:'arbitrary'}]) {
  assert.throws(()=>route(args),{code:'INVALID_ARGUMENTS'});
}
assert.equal(new URL(route({page:'settings',counterId:'123'}).address).searchParams.get('id'),'123');

// Verify the registered read-only contract without native input or a journal write.
const window={id:1,processId:2,processName:'firefox'};
const runtime=createConnectors({session:{windows:async()=>[window],bind:async()=>window,observe:async()=>snapshot}});
try {
  const result=await runtime.invoke({platform:'metrika',name:'counter.info'});
  assert.deepEqual(result.output,{taskStatus:'observed',counterId:'123',name:'Example',site:'example.org',saveEnabled:false});
} finally {await runtime.close();}
console.log('Metrika boundary passed: exact origin, counter/form identity and read-only dispatch.');
