import { Injectable } from '@nestjs/common';
import { InjectRepository } from './typeorm-bridge-lookalike';
import { Repository } from 'typeorm';
import { Row } from './row.entity';

@Injectable()
export class FakebridgeService {
  constructor(@InjectRepository(Row) private readonly repo: Repository<Row>) {}
  list() {
    return this.repo.find();
  }
}
