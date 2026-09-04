import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hit } from './hit.entity';

@Injectable()
export class HitsService {
  constructor(
    @InjectRepository(Hit)
    private readonly repo: Repository<Hit>,
  ) {}

  // `increment` is a real TypeORM method and it is NOT in the vocabulary the Lab
  // measured. Every other step of this chain is proved, so this route is the only
  // place the vocabulary itself is the deciding check.
  bump(id: string) {
    return this.repo.increment({ id }, 'count', 1);
  }
}
