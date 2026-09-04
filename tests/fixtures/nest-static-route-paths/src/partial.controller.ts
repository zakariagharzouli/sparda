// One decorator, two paths, one of them unreadable. Registering only the readable
// half would drop a URL the app really serves — a route lost, not a route unknown.
import { Controller, Post } from '@nestjs/common';

const KNOWN = '/partial/known';

@Controller()
export class PartialController {
  @Post([KNOWN, process.env.OTHER_PATH])
  create() {}
}
