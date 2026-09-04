import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { CatsService } from './cats.service';

@Controller('cats')
export class CatsController {
  constructor(private readonly catsService: CatsService) {}

  @Get()
  findAll(@Query('owner') owner: string) {
    return this.catsService.findAll(owner);
  }

  @Post()
  create(@Body('name') name: string) {
    return this.catsService.create(name);
  }
}
