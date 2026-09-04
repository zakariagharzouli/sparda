import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pin } from './pin.entity';

@Injectable()
export class LookalikeService {
  constructor(
    @InjectRepository(Pin)
    private readonly repo: Repository<Pin>,
  ) {}

  plain(dto: any) {
    return this.repo.save(dto);
  }
}
