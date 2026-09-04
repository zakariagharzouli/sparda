import { Injectable } from '@nestjs/common';
import { Repository } from './fake-typeorm';
import { Row } from './row.entity';

@Injectable()
export class FakeOrmService {
  constructor(private readonly repo: Repository<Row>) {}
  list() {
    return this.repo.find();
  }
}
