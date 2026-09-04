import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Row } from './row.entity';

@Injectable()
export class CallbackService {
  constructor(private readonly repo: Repository<Row>) {}
  list() {
    return [1].map(() => this.repo.find());
  }
}
