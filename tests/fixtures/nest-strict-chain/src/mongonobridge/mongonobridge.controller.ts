import { Controller, Get } from '@nestjs/common';
import { DogService } from './dog.service';

@Controller('mongonobridge')
export class DogController {
  constructor(private readonly svc: DogService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
