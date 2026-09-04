import { Injectable } from '@nestjs/common';
import { HopThreeService } from './hop-three.service';

@Injectable()
export class HopTwoService {
  constructor(private readonly three: HopThreeService) {}
  list() {
    return this.three.list();
  }
}
