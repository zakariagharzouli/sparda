// `process.env` is a member read of a value that does not exist until runtime.
import { Controller, Get } from '@nestjs/common';
import { ENV_API } from './env-constants';

@Controller()
export class EnvironmentController {
  @Get(`${ENV_API}/things`)
  list() {}
}
