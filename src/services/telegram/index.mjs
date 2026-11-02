import {commonOperations,objectSchema,planOperations} from '../interface/index.mjs';
import {requireThat} from '../../errors.mjs';

const planned=planOperations({
  message:'read send reply quote edit delete forward copy link pin unpin react unreact select search schedule silent translate',
  media:'send download open album voice video sticker gif poll contact location',
  chat:'open create archive unarchive pin unpin mute unmute clear delete unread read export search folder',
  group:'create info members add remove promote permissions invite join leave topics',
  channel:'create info subscribers post edit invite join leave statistics',
  contact:'add edit delete block unblock share',
  call:'start answer reject end mute camera share_screen',
  account:'login logout switch profile username privacy notifications sessions passcode two_step language proxy',
  premium:'open gift stars boost story',
  bot:'start command buttons webapp payment',
});
export function catalog() {
  return {platform:'telegram',processName:'telegram',transport:'windows-ui',observe:{maxElements:750,maxDepth:24,budgetMs:4000},
    operations:[...commonOperations,{name:'open',readOnly:false,durable:false,description:'Prepare verified username search. Read results, open the intended chat and verify its header separately.',inputSchema:{...objectSchema({username:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_]{3,31}$'}}),required:['username']}},
      {name:'channel.info',readOnly:true,durable:true,description:'Read the currently open channel profile header and subscriber label. Requires the profile panel to be open.',inputSchema:objectSchema({})},
      ...planned.filter(operation=>operation.name!=='channel.info')]};
}
export function route(args) {return {kind:'search',query:'@'+args.username};}
export function searchField(snapshot) {
  const fields=snapshot.elements.filter(e=>e.role==='Edit'&&e.enabled&&!e.offscreen&&/^(поиск|search)$/i.test(e.name));
  const inner=fields.filter(e=>e.automationId?.endsWith('::Inner'));
  const matches=inner.length?inner:fields;
  requireThat(matches.length===1,'SEARCH_FIELD_NOT_UNIQUE');
  return {automationId:matches[0].automationId,role:'Edit'};
}
export function read(name,snapshot) {
  requireThat(name==='channel.info','UNKNOWN_UI_OPERATION');
  const header=snapshot.elements.filter(e=>e.role==='Text'&&!e.offscreen&&e.automationId?.includes('Info::Profile::Widget.profileTopBar'));
  const title=header.filter(e=>e.automationId.endsWith('Ui::MarqueeLabel'));
  requireThat(title.length===1,'CHANNEL_PROFILE_NOT_OPEN');
  const subscribers=header.filter(e=>/^[\d.,\sKMBКМБ]+\s+(подписчик|subscriber)/i.test(e.name));
  requireThat(subscribers.length===1,'CHANNEL_SUBSCRIBERS_NOT_VERIFIED');
  const text=subscribers[0].name;
  const exact=/^([\d\s]+)\s+(?:подписчик|subscriber)/i.exec(text);
  return {title:title[0].name,subscribersText:text,subscribersCount:exact?Number(exact[1].replace(/\s/g,'')):null};
}
