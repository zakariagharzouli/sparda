import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Note } from './note.entity';

@Injectable()
export class DeferredService {
  constructor(
    @InjectRepository(Note)
    private readonly repo: Repository<Note>,
  ) {}

  // whether this runs, and when, is not something this grammar reads
  queue(dto: any) {
    process.nextTick(() => {
      this.repo.save(dto);
    });
  }

  now(dto: any) {
    return this.repo.save(dto);
  }
}
