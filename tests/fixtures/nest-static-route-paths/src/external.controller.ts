// An external package is not project-local source; the Core resolver has no entry
// for it, which is exactly the rejection the grammar wants.
import { Controller, Get } from '@nestjs/common';
import { API } from 'external-routes';

@Controller()
export class ExternalController {
  @Get(`${API}/things`)
  list() {}
}
