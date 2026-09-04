import { Injectable } from '@nestjs/common';

@Injectable()
export class AmbiguousPort {
  list(): unknown { return null; }
}
