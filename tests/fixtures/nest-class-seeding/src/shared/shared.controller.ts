import { Body, Controller, Delete, Param, Post, Put } from '@nestjs/common';
import { SharedService } from './shared.service';

@Controller('shared')
export class SharedController {
  constructor(private readonly svc: SharedService) {}

  // TWO ROUTES, ONE provider method, ONE repository call — ONE effect node in
  // the graph. Each route must carry its OWN provenance: a body surface here,
  // a path parameter there, and neither may license the other.
  @Post('by-body')
  fromBody(@Body() dto: any) {
    return this.svc.persist(dto);
  }

  @Put('by-param/:id')
  fromParam(@Param('id') id: string) {
    return this.svc.persist(id);
  }

  // the filter leg, on the same provider
  @Delete(':id')
  drop(@Param('id') id: string) {
    return this.svc.drop(id);
  }
}
