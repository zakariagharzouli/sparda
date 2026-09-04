import { Body, Controller, Post } from '@nestjs/common';
import { DeferredService } from './deferred.service';

@Controller('deferred')
export class DeferredController {
  constructor(private readonly deferred: DeferredService) {}

  // the controller calls directly; the SERVICE defers the ORM call
  @Post('queue')
  queue(@Body() dto: any) {
    return this.deferred.queue(dto);
  }

  // the CONTROLLER defers its own call to the provider
  @Post('later')
  later(@Body() dto: any) {
    return Promise.resolve().then(() => this.deferred.now(dto));
  }
}
