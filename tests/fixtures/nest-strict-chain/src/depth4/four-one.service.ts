import { Injectable } from '@nestjs/common';
import { FourTwoService } from './four-two.service';

@Injectable()
export class FourOneService {
  constructor(private readonly two: FourTwoService) {}
  list() {
    return this.two.list();
  }
}
