import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tab } from './tab.entity';

@Injectable()
export class TabService {
  constructor(
    @InjectRepository(Tab)
    private readonly repo: Repository<Tab>,
  ) {}

  persist(dto: any) {
    return this.repo.save(dto);
  }
}
