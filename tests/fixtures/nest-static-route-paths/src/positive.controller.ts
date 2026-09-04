// Every form the V1 grammar accepts. Each path here is forced at build time: the
// framework serves exactly these URLs and no evaluation is required to know it.
import { Controller, Get, Post } from '@nestjs/common';
import { API as ROOT, ADMIN } from './constants';

const LOCAL = '/local/health';
const SEG = '/twice';

@Controller()
export class PositiveController {
  // 3 — template literal over 5 — a named import, ALIASED
  @Get(`${ROOT}/things`)
  list() {}

  // 2 — an array of accepted expressions: ONE decorator, TWO routes
  @Post([`${ROOT}/things`, `${ROOT}/things/:id`])
  create() {}

  // 4 — a program-scope const in this module
  @Get(LOCAL)
  health() {}

  // 5 — an imported const whose own initializer is a template over another const
  @Get(ADMIN)
  admin() {}

  // the SAME const twice in one template: a binding seen again on a sibling
  // interpolation is a repeat, not a cycle
  @Get(`${SEG}${SEG}`)
  twice() {}

  // 1 — a plain literal, unchanged behaviour
  @Get('/plain')
  plain() {}
}
