import { Controller, Post } from '@nestjs/common';
import { Body } from './fake-common';
import { LookalikeService } from './lookalike.service';

@Controller('lookalike')
export class LookalikeController {
  constructor(private readonly svc: LookalikeService) {}

  // Everything about this route is direct, literal and readable. `Body` is the
  // PROJECT's, and that single fact is why no path is stated.
  @Post('local')
  local(@Body() dto: any) {
    return this.svc.plain(dto);
  }
}
