import { Injectable } from '@nestjs/common';
// NOT @nestjs/typeorm — a local file that happens to export the same name
import { InjectRepository } from './fake-typeorm';
import { Note } from './note.entity';

@Injectable()
export class NotesService {
  constructor(
    @InjectRepository(Note)
    private readonly repo: any,
  ) {}

  findOne(id: string) {
    return this.repo.findOne({ where: { id } });
  }
}
