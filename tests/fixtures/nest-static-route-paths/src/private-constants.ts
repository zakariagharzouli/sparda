// `HIDDEN` is program-scope but never exported: an importing module cannot read it,
// so resolving it would report a value the controller does not actually see.
const HIDDEN = '/hidden';

export const VISIBLE = '/visible';

export function hiddenRoot(): string {
  return HIDDEN;
}
