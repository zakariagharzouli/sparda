import { Controller, Get, Inject } from '@nestjs/common';
import { IncongruentService } from './incongruent.service';
import { OtherService } from './other.service';

@Controller('incongruent')
export class IncongruentController {
  constructor(@Inject(OtherService) private readonly svc: IncongruentService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
