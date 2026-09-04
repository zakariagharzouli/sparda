import { Body, Controller, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mark } from './mark.entity';
import { MarkService } from './mark.service';

@Controller('factory')
export class FactoryController {
  constructor(
    private readonly svc: MarkService,
    @InjectRepository(Mark)
    private readonly repo: Repository<Mark>,
  ) {}

  // Everything on this route is direct and literal. The MODULE hands the class
  // to a factory, so which body arrives here is decided at runtime.
  @Post()
  create(@Body() dto: any) {
    return this.svc.persist(dto);
  }

  // The controller writes in its OWN body, and its module proves no binding.
  // A surface seeded without the gate would land here — which is what makes the
  // gate observable rather than merely stated.
  @Post('direct')
  direct(@Body() dto: any) {
    return this.repo.save(dto);
  }
}
