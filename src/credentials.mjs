import { requireThat } from './errors.mjs';

// Resolve only an explicit reference. Returned values never enter plans or receipts.
export function credentialParameters(reference, environment=process.env) {
  requireThat(typeof reference==='string'&&reference.length<=512,'INVALID_SECRET_REF');
  if(reference.startsWith('wincred:')) {
    const target=reference.slice(8);requireThat(target.length>0&&!/[\r\n\0]/.test(target),'INVALID_SECRET_REF');
    return {credentialTarget:target};
  }
  const match=/^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(reference);
  requireThat(match,'INVALID_SECRET_REF');
  const value=environment[match[1]];
  requireThat(typeof value==='string'&&value.length>0&&value.length<=16384,'SECRET_UNAVAILABLE');
  return {value};
}
