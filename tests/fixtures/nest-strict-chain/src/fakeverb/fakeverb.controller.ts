import { Controller } from '@nestjs/common';
import { Get } from './verb-lookalike';
import { FakeverbService } from './fakeverb.service';

@Controller('fakeverb')
export class FakeverbController {
  constructor(private readonly svc: FakeverbService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
