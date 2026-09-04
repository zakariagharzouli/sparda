import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Row } from './row.entity';

@Injectable()
export class PositionsService {
  constructor(
    @InjectRepository(Row)
    private readonly repo: Repository<Row>,
  ) {}

  plain(dto: any) {
    return this.repo.save(dto);
  }

  gathers(...rest: any[]) {
    return this.repo.save(rest[0]);
  }

  unpacks({ name }: any) {
    return this.repo.save({ name });
  }

  spreadsBelow(dto: any) {
    return this.repo.save(...[dto]);
  }
}
