import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CurrentUser, Meta } from './fake-common';
import { SurfacesService } from './surfaces.service';

@Controller('surfaces')
export class SurfacesController {
  constructor(private readonly svc: SurfacesService) {}

  // `Body` here IS Nest's — the provenance check passes and the COUNT check is
  // what decides. Two decorators are two claims about one value, and this grammar
  // reads one kind; refusing is how it avoids picking.
  @Post('two')
  two(@Body() @Meta() dto: any) {
    return this.svc.plain(dto);
  }

  // a pipe written as a CONFIGURED INSTANCE — its behaviour is decided by a value
  // this grammar does not read
  @Get('pipe/:id')
  pipe(@Param('id', new ParseIntPipe()) id: number) {
    return this.svc.byId(id);
  }

  // a custom decorator is not one of the three request surfaces
  @Get('custom')
  custom(@CurrentUser('id') id: string) {
    return this.svc.byId(id);
  }
}
