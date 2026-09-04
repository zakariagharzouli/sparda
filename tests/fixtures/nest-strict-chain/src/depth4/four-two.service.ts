import { Injectable } from '@nestjs/common';
import { FourThreeService } from './four-three.service';

@Injectable()
export class FourTwoService {
  constructor(private readonly three: FourThreeService) {}
  list() {
    return this.three.list();
  }
}
