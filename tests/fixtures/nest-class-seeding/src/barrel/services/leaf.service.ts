import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Leaf } from '../leaf.entity';

@Injectable()
export class LeafService {
  constructor(
    @InjectRepository(Leaf)
    private readonly repo: Repository<Leaf>,
  ) {}

  persist(dto: any) {
    return this.repo.save(dto);
  }
}
