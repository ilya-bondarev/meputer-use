import {commonOperations,objectSchema,planOperations} from '../interface/index.mjs';
import {validateValue} from '../../contracts.mjs';
import {requireThat} from '../../errors.mjs';

const origin='https://metrika.yandex.ru';
const counterIdSchema={type:'string',pattern:'^[1-9][0-9]*$'};
const globalPages={counters:{path:'/list'},preferences:{path:'/preferences/subscriptions'}};
const counterPages={
  overview:{path:'/overview'},
  settings:{path:'/settings',query:{tab:'common'}},
  goals:{path:'/stat/conversion_rate',query:{goalsConversionViewKind:'List'}},
  conversions:{path:'/stat/conversion_rate',query:{goalsConversionViewKind:'Chart'}},
  filters:{path:'/settings',query:{tab:'filters'}},
  integrations:{path:'/marketplace'},
  tag_manager:{path:'/ytm/overview'},
  insights:{path:'/insights'},
};
const openSchema={...objectSchema({page:{enum:[...Object.keys(globalPages),...Object.keys(counterPages)]},counterId:counterIdSchema}),required:['page'],
  oneOf:[
    {properties:{page:{enum:Object.keys(globalPages)}},not:{required:['counterId']}},
    {properties:{page:{enum:Object.keys(counterPages)}},required:['counterId']},
  ]};
const planned=planOperations({
  counter:'create edit delete restore code check',
  goal:'create edit delete test',
  report:'open configure export save delete_saved',
  segment:'create apply edit delete',
  filter:'create edit delete',
  access:'grant change revoke',
  dashboard:'create edit delete',
  behavior:'webvisor clickmap scrollmap form_analysis',
  integration:'connect configure disconnect',
  data:'upload',
});

export function catalog() {
  return {platform:'metrika',processName:'firefox',transport:'windows-ui',observe:{activeDocument:true,maxElements:750,maxDepth:24,budgetMs:4000},
    operations:[...commonOperations,
      {name:'open',readOnly:false,durable:false,description:'Navigate to a Metrika section. Counter pages require counterId; goals opens conversion results, goal editing uses an observed settings plan. Navigation alone is unverified.',inputSchema:openSchema},
      {name:'counter.info',readOnly:true,durable:true,description:'Read the current common-settings form: counter ID, name, site and Save availability. Form values may be unsaved; this is not proof of persisted settings or tag installation.',inputSchema:objectSchema({})},
      ...planned]};
}

export function route(args) {
  validateValue(openSchema,args);
  const destination=globalPages[args.page]??counterPages[args.page];
  const query=new URLSearchParams(destination.query);
  if(args.counterId)query.set('id',args.counterId);
  return {kind:'address',address:origin+destination.path+(query.size?'?'+query:'')};
}

function pageAddress(snapshot) {
  const value=snapshot.url??snapshot.elements?.find(e=>e.role==='Document')?.value;
  let address;
  try {address=new URL(value);} catch {requireThat(false,'CONNECTOR_PAGE_MISMATCH');}
  requireThat(address.origin===origin&&!address.username&&!address.password,'CONNECTOR_PAGE_MISMATCH');
  return address;
}
export function validatePage(snapshot) {pageAddress(snapshot);}

function fieldValue(snapshot,name) {
  const fields=snapshot.elements.filter(e=>e.role==='Edit'&&e.name===name&&!e.password);
  requireThat(fields.length===1&&typeof fields[0].value==='string','COUNTER_SETTINGS_NOT_VERIFIED');
  return fields[0].value;
}
export function read(name,snapshot) {
  requireThat(name==='counter.info','UNKNOWN_UI_OPERATION');
  const address=pageAddress(snapshot);
  requireThat(!snapshot.truncated,'INCOMPLETE_OBSERVATION');
  requireThat(address.pathname==='/settings'&&address.searchParams.getAll('tab').length===1&&address.searchParams.get('tab')==='common','COUNTER_SETTINGS_NOT_OPEN');
  const ids=address.searchParams.getAll('id');
  requireThat(ids.length===1,'COUNTER_ID_NOT_VERIFIED');
  validateValue(counterIdSchema,ids[0]);
  // A router URL can change before the form. Its own number must agree with it.
  requireThat(snapshot.elements.some(e=>e.role==='Text'&&e.name==='Номер '+ids[0]),'COUNTER_ID_NOT_VERIFIED');
  const save=snapshot.elements.filter(e=>e.role==='Button'&&e.name==='Сохранить');
  return {counterId:ids[0],name:fieldValue(snapshot,'Имя счетчика'),site:fieldValue(snapshot,'Домен или путь (без http, https и www)'),saveEnabled:save.length===1?save[0].enabled:null};
}
