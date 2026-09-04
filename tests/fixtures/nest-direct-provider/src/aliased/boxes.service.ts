import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Box } from './box.entity';

@Injectable()
export class BoxesService {
  constructor(
    @InjectRepository(Box)
    private readonly repo: Repository<Box>,
  ) {}

  findOne(id: string) {
    return this.repo.findOne({ where: { id } });
  }
}
