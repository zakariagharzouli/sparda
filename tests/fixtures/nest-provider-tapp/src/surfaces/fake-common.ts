// Decorators that are NOT Nest's. `Meta` sits beside a real `@Body()` so the
// count check is the deciding one there; `Body` lives in `../lookalike` under
// Nest's exact name, so the PROVENANCE check is the deciding one over there.
export const Meta = (): ParameterDecorator => () => {};
export const CurrentUser =
  (_key?: string): ParameterDecorator =>
  () => {};
