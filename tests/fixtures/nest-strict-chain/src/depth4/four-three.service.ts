import { Injectable } from '@nestjs/common';
import { FourFourService } from './four-four.service';

@Injectable()
export class FourThreeService {
  constructor(private readonly four: FourFourService) {}
  list() {
    return this.four.list();
  }
}
