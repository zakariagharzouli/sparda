import { Injectable } from '@nestjs/common';
import { InjectRepository } from './fake-inject';
import { Doc } from './doc.entity';

@Injectable()
export class DocsService {
  constructor(
    @InjectRepository(Doc)
    private readonly repo: any,
  ) {}

  findOne(id: string) {
    return this.repo.findOne({ where: { id } });
  }
}
