// Two constants that import each other. Without a cycle guard the walk recurses
// until the stack gives out instead of declaring the limit.
import { Controller, Get } from '@nestjs/common';
import { A } from './cycle-a';

@Controller()
export class CycleController {
  @Get(`${A}/things`)
  list() {}
}
