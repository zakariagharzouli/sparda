// A module the Core resolver cannot open at all.
import { Controller, Get } from '@nestjs/common';
import { MISSING } from './does-not-exist';

@Controller()
export class UnresolvedController {
  @Get(`${MISSING}/things`)
  list() {}
}
