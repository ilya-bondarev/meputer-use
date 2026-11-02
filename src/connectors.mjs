import {DesktopSession} from './desktop.mjs';
import {validateValue} from './contracts.mjs';
import {createUiDriver} from './ui.mjs';
import {createConnectorJournal} from './connector-journal.mjs';
import {requireThat} from './errors.mjs';
import {validatePlan} from './services/interface/index.mjs';
import {platformNames,hasConnectorDomain,connectorDomain} from './connector-registry.mjs';
export {platformNames} from './connector-registry.mjs';

export function createConnectors({mode='read-only',session,sessionFactory,journal,stopFile,allowedProcesses=['telegram','firefox']}={}) {
  requireThat(['read-only','execute'].includes(mode),'INVALID_MODE');
  let desktop=session;const owned=!session;
  const receipts=journal||createConnectorJournal();let busy=false;
  const getSession=()=>desktop||=(sessionFactory?sessionFactory():new DesktopSession({mode,allowedProcesses,stopFile}));
  function definition(call) {
    requireThat(call&&hasConnectorDomain(call.platform)&&(!call.backend||call.backend==='ui'),'INVALID_CONNECTOR_CALL');
    const domain=connectorDomain(call.platform),description=domain.catalog();
    const operation=description.operations.find(o=>o.name===call.name);
    requireThat(operation,'UNKNOWN_UI_OPERATION');
    validateValue(operation.inputSchema,call.args||{});
    if(call.name==='ui.plan'||operation.execution==='observed_plan')validatePlan(call.args.plan);
    return {domain,description,operation};
  }
  async function perform(call,signal) {
    let deliveryStarted=false;
    try {
    const {domain,description,operation}=definition(call);const args=call.args||{};
    const desktop=getSession();
    let selector=call.window;
    if(!selector) {
      const windows=(await desktop.windows()).filter(w=>w.processName.toLowerCase()===description.processName);
      requireThat(windows.length===1,'WINDOW_NOT_UNIQUE');selector={id:windows[0].id,processId:windows[0].processId};
    }
    const window=await desktop.bind(selector);
    requireThat(window.processName.toLowerCase()===description.processName,'CONNECTOR_WINDOW_MISMATCH');
    const ui=createUiDriver(desktop,{signal});const observe={...description.observe,...args.observe};
    const run=async()=>{
      if(!operation.readOnly)await desktop.activate();
      if(call.name==='ui.text') {
        const document=await desktop.document(args);
        domain.validatePage?.(document);
        return {taskStatus:'observed',document};
      }
      if(operation.readOnly) {
        const snapshot=await ui.read(observe);
        domain.validatePage?.(snapshot);
        return call.name==='ui.read'?{taskStatus:'observed',snapshot}:{taskStatus:'observed',...domain.read(call.name,snapshot)};
      }
      if(domain.validatePage&&call.name!=='open') domain.validatePage(await ui.read(description.observe));
      if(call.name==='auth.fill') {deliveryStarted=true;return desktop.fillSecret({...args,observe});}
      if(call.name==='ui.action') {
        deliveryStarted=true;
        const parameters=args.parameters;
        if(parameters.selector) {requireThat(args.operation==='click','INVALID_SELECTOR_ACTION');await ui.click(parameters.selector,observe,parameters.button);}
        else await desktop.action(args.operation,parameters);
        return {taskStatus:'unverified',operation:args.operation};
      }
      if(call.name==='open') {
        deliveryStarted=true;
        const route=domain.route(args);
        if(route.kind==='address') {
          await ui.navigate(route.address);
          const snapshot=await ui.wait(s=>{try{domain.validatePage(s);return true;}catch{return false;}},observe);
          return {taskStatus:'unverified',address:snapshot.elements[0]?.value};
        }
        let snapshot=await ui.read({...observe,maxDepth:10});let field;
        try {field=domain.searchField(snapshot);}catch(error) {
          if(error.code!=='SEARCH_FIELD_NOT_UNIQUE')throw error;
          await ui.input('key',{keys:['ESC']});snapshot=await ui.read({...observe,maxDepth:10});field=domain.searchField(snapshot);
        }
        const scope={scope:{automationId:field.automationId},maxElements:30,maxDepth:8,budgetMs:3000};
        await ui.click(field,scope);await ui.input('key',{keys:['CTRL','A']});await ui.input('type',{text:route.query});
        await ui.wait(s=>s.elements.some(e=>e.role==='Edit'&&e.value===route.query),scope);
        return {taskStatus:'unverified',search:route.query,searchVerified:true,next:'Read results and verify the chat header after opening; search selection alone is insufficient.'};
      }
      if(call.name==='bookmarks.collect') {
        let state=domain.startBookmarks(args);
        while(!state.done) {
          state=domain.advanceBookmarks(state,await ui.read(observe));
          if(state.done)return {taskStatus:'verified',links:state.posts.slice(0,state.limit).map(post=>post.url),pages:state.page};
          deliveryStarted=true;
          await ui.scroll(observe);
          await new Promise(resolve=>setTimeout(resolve,250));signal?.throwIfAborted();
        }
      }
      deliveryStarted=true;
      const result=await desktop.runPlan(args.plan,{signal,maxDurationMs:45000});
      requireThat(result.status==='completed',result.reason||'UI_PLAN_UNVERIFIED');
      return {taskStatus:'verified',result};
    };
    return await (operation.readOnly?run():desktop.withInputLease(run));
    }catch(error){if(!deliveryStarted)error.safeToRetry=true;throw error;}
  }
  return {
    catalog({platform,name}={}) {
      requireThat(!platform||hasConnectorDomain(platform),'UNKNOWN_PLATFORM');
      const descriptions=(platform?[connectorDomain(platform)]:platformNames.map(connectorDomain)).map(d=>d.catalog());
      if(name) {const operations=descriptions.flatMap(d=>d.operations).filter(o=>o.name===name);requireThat(operations.length,'UNKNOWN_UI_OPERATION');return operations;}
      return descriptions;
    },
    describe:definition,
    async invoke(call,{signal}={}) {
      signal?.throwIfAborted();const {operation}=definition(call);
      requireThat(!busy,'CONNECTOR_BUSY');
      if(!operation.readOnly)requireThat(mode==='execute','READ_ONLY');
      busy=true;
      try {
        if(operation.readOnly)return {platform:call.platform,operation:call.name,output:await perform(call,signal)};
        // Validation and mode checks occur before the durable delivery claim.
        return await receipts.execute(call.requestId,{platform:call.platform,name:call.name,args:call.args||{},window:call.window||null},()=>perform(call,signal));
      } finally {busy=false;}
    },
    inspect:id=>receipts.inspect(id),
    async close() {receipts.close();if(owned)await desktop?.close();},
  };
}
