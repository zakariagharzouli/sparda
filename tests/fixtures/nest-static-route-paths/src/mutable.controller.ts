// `let` can be reassigned between module evaluation and the decorator running, so
// its parse-time value is not the value Nest sees.
import { Controller, Get } from '@nestjs/common';

let MUTABLE = '/mutable';

@Controller()
export class MutableController {
  @Get(`${MUTABLE}/things`)
  list() {}
}
