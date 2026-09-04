import { Controller, Get, Inject } from '@nestjs/common';
import { TokenService } from './token.service';

@Controller('injecttoken')
export class InjectTokenController {
  constructor(@Inject(TokenService) private readonly svc: TokenService) {}
  @Get()
  list() {
    return this.svc.list();
  }
}
