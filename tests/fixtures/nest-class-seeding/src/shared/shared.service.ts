import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Thing } from './thing.entity';

@Injectable()
export class SharedService {
  constructor(
    @InjectRepository(Thing)
    private readonly repo: Repository<Thing>,
  ) {}

  persist(value: any) {
    return this.repo.save(value);
  }

  drop(id: string) {
    return this.repo.delete(id);
  }
}
