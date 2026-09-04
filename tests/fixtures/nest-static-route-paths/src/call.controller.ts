// A call and a property read: both outside the grammar, both left declared.
import { Controller, Get, Post } from '@nestjs/common';

const CONFIG = { prefix: '/cfg' };
function buildPath(): string {
  return '/built';
}

@Controller()
export class CallController {
  @Get(buildPath())
  built() {}

  @Post(`${CONFIG.prefix}/things`)
  member() {}
}
