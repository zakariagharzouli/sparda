import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Leaf } from './leaf.entity';

@Injectable()
export class UnplaceableService {
  constructor(
    @InjectRepository(Leaf)
    private readonly repo: Repository<Leaf>,
  ) {}

  plain(dto: any) {
    return this.repo.save(dto);
  }

  wrapsBelow(dto: any) {
    return this.repo.save([dto]);
  }

  pair(first: any, second: any) {
    return this.repo.save({ first, second });
  }

  ignores(dto: any) {
    const fixed = { name: 'constant' };
    return this.repo.save(fixed);
  }

  // in the V1 operation vocabulary, absent from the role table on purpose
  drops(dto: any) {
    return this.repo.remove(dto);
  }
}
