import { Injectable } from '@nestjs/common';
import { HopTwoService } from './hop-two.service';

@Injectable()
export class HopOneService {
  constructor(private readonly two: HopTwoService) {}
  list() {
    return this.two.list();
  }
}
