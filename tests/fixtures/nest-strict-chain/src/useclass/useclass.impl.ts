import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Row } from './row.entity';

@Injectable()
export class UseClassImpl {
  constructor(
    @InjectRepository(Row) private readonly repo: Repository<Row>,
  ) {}
  list() {
    return this.repo.find();
  }
}
