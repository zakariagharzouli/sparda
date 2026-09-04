import { Controller, Get } from '@nestjs/common';
import { CatService } from './cat.service';

@Controller('mongoose')
export class CatController {
  constructor(private readonly svc: CatService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
