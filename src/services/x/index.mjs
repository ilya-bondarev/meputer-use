import {commonOperations,objectSchema,planOperations} from '../interface/index.mjs';
import {postUrl as canonicalPost} from './post-url.mjs';
import {requireThat} from '../../errors.mjs';

const destinations={home:'/home',bookmarks:'/i/bookmarks',notifications:'/notifications',messages:'/messages',lists:'/i/lists',communities:'/i/communities',settings:'/settings/account',compose:'/compose/post',explore:'/explore',history:'/i/history'};
const planned=planOperations({
  post:'read create reply quote repost undo_repost edit delete like unlike bookmark unbookmark pin unpin copy_link translate report',
  media:'upload download open alt_text poll gif',
  bookmarks:'read folder move remove',
  profile:'open edit follow unfollow followers following subscribe notify block unblock mute unmute lists',
  search:'query latest people media advanced',
  message:'read send reply edit delete react media request block',
  list:'create edit delete add_member remove_member subscribe unsubscribe pin',
  community:'join leave create post moderate',
  space:'join start speak mute leave end schedule',
  account:'login logout switch privacy notifications security sessions language premium monetization',
  notification:'read filter settings',
});
export function catalog() {
  return {platform:'x',processName:'firefox',transport:'windows-ui',observe:{activeDocument:true,maxElements:1000,maxDepth:30,budgetMs:5000},
    operations:[...commonOperations,
      {name:'open',readOnly:false,durable:false,description:'Navigate Firefox with its address bar; verify the opened page.',inputSchema:{...objectSchema({page:{enum:Object.keys(destinations)},username:{type:'string',pattern:'^[A-Za-z0-9_]{1,15}$'},query:{type:'string',minLength:1,maxLength:2048},postUrl:{type:'string',maxLength:2048}}),minProperties:1,maxProperties:1}},
      {name:'bookmarks.collect',readOnly:false,durable:false,description:'Collect canonical post links from the visible Bookmarks tab using UI accessibility and native scrolling.',inputSchema:objectSchema({limit:{type:'integer',minimum:1,maximum:1000},maxPages:{type:'integer',minimum:1,maximum:500}})},
      ...planned]};
}
export function route(args) {
  let path;
  if(args.page)path=destinations[args.page];
  else if(args.username)path='/'+args.username;
  else if(args.query)path='/search?q='+encodeURIComponent(args.query);
  else {const post=canonicalPost(args.postUrl);requireThat(post,'INVALID_POST_URL');return {kind:'address',address:post.url};}
  return {kind:'address',address:'https://x.com'+path};
}
export function validatePage(snapshot) {
  const address=snapshot.url??snapshot.elements.find(e=>e.role==='Document')?.value;
  requireThat(/^https:\/\/(x|twitter)\.com(?:\/|$)/.test(address||''),'CONNECTOR_PAGE_MISMATCH');
}
// A URL change alone can expose the previous post during React rendering.
// The target post's own timestamp link must exist before its text is read.
export function postReadiness(address) {
  const post=canonicalPost(address);
  return post?{readySelector:'article[data-testid="tweet"]:has(a[href$="/status/'+post.id+'"] > time)'}:null;
}
export {postUrl as canonicalPost} from './post-url.mjs';
export {bookmarkLinks,bookmarkItems,startBookmarks,advanceBookmarks} from './ui-bookmarks.mjs';
