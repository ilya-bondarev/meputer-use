import { isAbsolute } from 'node:path';
import { requireThat } from '../../errors.mjs';

export function validatePageRequest(value) {
  if(value.url)requireThat(/^https?:$/.test(new URL(value.url).protocol),'INVALID_ADDRESS');
  if(value.contains!==undefined)requireThat(typeof value.contains==='string'&&value.contains.length>0&&value.contains.length<=2048,'INVALID_PAGE_MARKER');
  if(value.outFile)requireThat(isAbsolute(value.outFile),'ABSOLUTE_PATH_REQUIRED');
  if(value.maxChars!==undefined)requireThat(Number.isInteger(value.maxChars)&&value.maxChars>0&&value.maxChars<=500000,'INVALID_PAGE_LIMIT');
  if(value.timeoutMs!==undefined)requireThat(Number.isInteger(value.timeoutMs)&&value.timeoutMs>0&&value.timeoutMs<=120000,'INVALID_TIMEOUT');
  if(value.navigation!==undefined)requireThat(['address','spa'].includes(value.navigation),'INVALID_NAVIGATION');
  if(value.format!==undefined)requireThat(['text','dom','html'].includes(value.format),'INVALID_PAGE_FORMAT');
  if(value.readySelector!==undefined)requireThat(typeof value.readySelector==='string'&&value.readySelector.length>0&&value.readySelector.length<=4096,'INVALID_PAGE_SELECTOR');
  requireThat(value.navigation!=='spa'||!!value.contains||!!value.readySelector,'SPA_READY_MARKER_REQUIRED');
}
export const pageNeedsInput=request=>!!request.url||!!request.readySelector||['dom','html'].includes(request.format);
