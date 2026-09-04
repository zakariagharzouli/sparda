import { Body, Controller, Post } from '@nestjs/common';
import { UnplaceableService } from './unplaceable.service';

@Controller('unplaceable')
export class UnplaceableController {
  constructor(private readonly svc: UnplaceableService) {}

  // wrapped in an array: the value travels, and no position describes it
  @Post('array')
  array(@Body() dto: any) {
    return this.svc.plain([dto]);
  }

  // readable to the provider, unreadable inside the ORM call
  @Post('nested')
  nested(@Body() dto: any) {
    return this.svc.wrapsBelow(dto);
  }

  // one value, two positions: no single journey describes it
  @Post('twice')
  twice(@Body() dto: any) {
    return this.svc.pair(dto, dto);
  }

  // it arrives, and it is not what the effect reads
  @Post('other')
  other(@Body() dto: any) {
    return this.svc.ignores(dto);
  }

  // `remove` is a proved operation with no measured ROLE for its argument
  @Post('remove')
  remove(@Body() dto: any) {
    return this.svc.drops(dto);
  }
}
