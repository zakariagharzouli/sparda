import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mark } from './mark.entity';

@Injectable()
export class MarkService {
  constructor(
    @InjectRepository(Mark)
    private readonly repo: Repository<Mark>,
  ) {}

  persist(dto: any) {
    return this.repo.save(dto);
  }
}
