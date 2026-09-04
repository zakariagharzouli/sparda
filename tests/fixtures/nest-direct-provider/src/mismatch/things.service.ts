import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Thing } from './thing.entity';

@Injectable()
export class ThingsService {
  constructor(
    @InjectRepository(Thing)
    private readonly repo: Repository<Thing>,
  ) {}

  findOne(id: string) {
    return this.repo.findOne({ where: { id } });
  }
}
