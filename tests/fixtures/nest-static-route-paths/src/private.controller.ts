// A named import of a MODULE-PRIVATE const. The binding exists at program scope in
// the target module, which is exactly why only the export check can reject it.
import { Controller, Get } from '@nestjs/common';
import { HIDDEN } from './private-constants';

@Controller()
export class PrivateController {
  @Get(`${HIDDEN}/things`)
  list() {}
}
