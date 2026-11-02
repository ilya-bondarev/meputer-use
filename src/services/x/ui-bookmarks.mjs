import {postUrl} from './post-url.mjs';
import {requireThat} from '../../errors.mjs';

// Interpret only UI accessibility values; scrolling belongs to the caller.
function bookmarkArticles(snapshot) {
  const document=snapshot.elements.find(e=>e.role==='Document'&&!e.offscreen);
  requireThat(document&&/^https:\/\/(x|twitter)\.com\/i\/(history|bookmarks)(?:[/?#]|$)/.test(document.value||''),'NOT_BOOKMARKS_PAGE');
  requireThat(snapshot.elements.some(e=>e.role==='TabItem'&&/^(bookmarks|закладки)$/i.test(e.name)&&e.selected===true),'BOOKMARKS_TAB_NOT_VERIFIED');
  const byRef=new Map(snapshot.elements.map(e=>[e.ref,e]));
  const children=new Map();
  for(const e of snapshot.elements) {if(!children.has(e.parent))children.set(e.parent,[]);children.get(e.parent).push(e);}
  const article=e=>/^(article|статья)$/i.test(e.kind||'');
  const links=[];const seen=new Set();
  function firstPost(element,visited=new Set()) {
    if(visited.has(element.ref))return null;visited.add(element.ref);
    const post=element.role==='Hyperlink'&&element.value?postUrl(element.value):null;
    if(post)return post;
    for(const child of children.get(element.ref)||[]) {
      if(article(child))continue;
      const result=firstPost(child,visited);if(result)return result;
    }
    return null;
  }
  for(const element of snapshot.elements.filter(article)) {
    let parent=byRef.get(element.parent),nested=false;const visited=new Set();
    while(parent&&!visited.has(parent.ref)) {visited.add(parent.ref);if(article(parent)){nested=true;break;}parent=byRef.get(parent.parent);}
    if(nested)continue;
    const post=firstPost(element);
    if(post&&!seen.has(post.id)){seen.add(post.id);links.push({post,article:element});}
  }
  return links;
}
export function bookmarkLinks(snapshot) {
  return bookmarkArticles(snapshot).map(row=>row.post);
}
export function bookmarkItems(snapshot) {
  const byRef=new Map(snapshot.elements.map(element=>[element.ref,element]));
  return bookmarkArticles(snapshot).map(({post,article})=>{
    const controls=snapshot.elements.filter(element=>{
      if(element.role!=='Button'||!['Bookmarked','Bookmark'].includes(element.name))return false;
      let parent=byRef.get(element.parent);const visited=new Set();
      while(parent&&!visited.has(parent.ref)) {
        if(parent.ref===article.ref)return true;
        if(/^(article|статья)$/i.test(parent.kind||''))return false;
        visited.add(parent.ref);parent=byRef.get(parent.parent);
      }
      return false;
    });
    requireThat(controls.length<=1,'BOOKMARK_CONTROL_AMBIGUOUS');
    const control=controls[0]??null;
    return {...post,article,control,bookmarked:control?control.name==='Bookmarked':null};
  });
}
export function startBookmarks({limit=20,maxPages=80}={}) {
  return {limit,maxPages,page:0,unchanged:0,posts:[],done:false};
}
export function advanceBookmarks(state,snapshot) {
  const posts=new Map(state.posts.map(post=>[post.id,post]));
  for(const post of bookmarkLinks(snapshot))if(!posts.has(post.id))posts.set(post.id,post);
  const unchanged=posts.size===state.posts.length?state.unchanged+1:0;
  const next={...state,page:state.page+1,unchanged,posts:[...posts.values()],done:posts.size>=state.limit};
  requireThat(next.done||(unchanged<6&&next.page<state.maxPages),'BOOKMARKS_INCOMPLETE');
  return next;
}
