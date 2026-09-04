import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Doc } from './doc.entity';

@Injectable()
export class ReboundService {
  constructor(
    @InjectRepository(Doc)
    private readonly repo: Repository<Doc>,
  ) {}

  plain(dto: any) {
    return this.repo.save(dto);
  }

  // the parameter is replaced before the effect reads it
  overwrites(dto: any) {
    dto = { title: 'constant' };
    return this.repo.save(dto);
  }
}
