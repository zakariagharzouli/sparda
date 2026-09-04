import { Controller } from './nest-lookalike';
import { Get } from '@nestjs/common';
import { FakeNestService } from './fakenest.service';

@Controller('fakenest')
export class FakeNestController {
  constructor(private readonly svc: FakeNestService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
