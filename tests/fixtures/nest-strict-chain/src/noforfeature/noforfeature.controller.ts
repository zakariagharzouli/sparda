import { Controller, Get } from '@nestjs/common';
import { NoforfeatureService } from './noforfeature.service';

@Controller('noforfeature')
export class NoforfeatureController {
  constructor(private readonly svc: NoforfeatureService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
