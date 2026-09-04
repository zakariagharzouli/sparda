import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Row } from './row.entity';

@Injectable()
export class UsefactoryService {
  constructor(private readonly repo: Repository<Row>) {}
  list() {
    return this.repo.find();
  }
}
