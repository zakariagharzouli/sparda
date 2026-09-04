import { Controller, Get } from '@nestjs/common';
import { UsefactoryService } from './usefactory.service';

@Controller('usefactory')
export class UsefactoryController {
  constructor(private readonly svc: UsefactoryService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
