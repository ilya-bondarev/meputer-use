import { setTimeout as delay } from 'node:timers/promises';
import { requireThat } from '../../errors.mjs';
import { postUrl } from './post-url.mjs';

// Read only page content. Take the time link of each *outer* article, so a
// quoted post/photo link is not mistaken for the saved post's canonical URL.
export async function collectXBookmarks(client, { limit = 20, maxPages = 80, signal, onProgress = () => {} } = {}) {
  requireThat(Number.isInteger(limit) && limit > 0 && limit <= 1000, 'INVALID_LIMIT');
  const links = []; const seen = new Set(); let unchanged = 0;
  for (let page = 0; page < maxPages && links.length < limit; page++) {
    signal?.throwIfAborted();
    const view = await client.evaluate(`return {
      url:location.href,
      tabs:Array.from(document.querySelectorAll('[role="tab"]')).map(t=>({text:t.innerText,selected:t.getAttribute('aria-selected')})),
      links:Array.from(document.querySelectorAll('article')).filter(a=>!a.parentElement.closest('article')).map(a=>a.querySelector('a:has(time)')?.href).filter(Boolean)
    };`);
    requireThat(/^https:\/\/(x|twitter)\.com\/i\/(history|bookmarks)/.test(view.url), 'NOT_BOOKMARKS_PAGE');
    requireThat(view.tabs.some(t => /bookmarks|закладки/i.test(t.text) && t.selected === 'true'), 'BOOKMARKS_TAB_NOT_VERIFIED');
    const before = links.length;
    for (const href of view.links) {
      const match = postUrl(href);
      if (match && !seen.has(match.id)) { seen.add(match.id); links.push(match.url); }
      if (links.length >= limit) break;
    }
    await onProgress({ page, count: links.length });
    unchanged = before === links.length ? unchanged + 1 : 0;
    if (unchanged >= 8 || links.length >= limit) break;
    await client.evaluate('window.scrollBy(0,Math.round(innerHeight*0.75)); return true;');
    await delay(500, undefined, { signal });
  }
  requireThat(links.length >= limit, 'BOOKMARKS_INCOMPLETE');
  return links.slice(0, limit);
}

