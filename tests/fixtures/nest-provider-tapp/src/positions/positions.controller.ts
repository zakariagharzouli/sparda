import { Body, Controller, Post } from '@nestjs/common';
import { PositionsService } from './positions.service';

@Controller('positions')
export class PositionsController {
  constructor(private readonly svc: PositionsService) {}

  // a SPREAD makes every later position unknowable
  @Post('spread')
  spread(@Body() dto: any) {
    return this.svc.plain(...[dto]);
  }

  // a REST parameter changes what "position 0" means
  @Post('rest')
  rest(@Body() dto: any) {
    return this.svc.gathers(dto);
  }

  // a DESTRUCTURED parameter is not a position this grammar can name
  @Post('destructured')
  destructured(@Body() dto: any) {
    return this.svc.unpacks(dto);
  }

  // the spread is in the ORM call, one hop further down
  @Post('ormspread')
  ormspread(@Body() dto: any) {
    return this.svc.spreadsBelow(dto);
  }
}
