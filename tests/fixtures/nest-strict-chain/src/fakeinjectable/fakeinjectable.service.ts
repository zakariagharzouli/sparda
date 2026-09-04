import { Injectable } from './injectable-lookalike';
import { Repository } from 'typeorm';
import { Row } from './row.entity';

@Injectable()
export class FakeinjectableService {
  constructor(private readonly repo: Repository<Row>) {}
  list() {
    return this.repo.find();
  }
}
