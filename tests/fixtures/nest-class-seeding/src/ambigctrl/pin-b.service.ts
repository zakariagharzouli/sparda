import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pin } from './pin.entity';

@Injectable()
export class PinBService {
  constructor(
    @InjectRepository(Pin)
    private readonly repo: Repository<Pin>,
  ) {}

  persist(dto: any) {
    return this.repo.save(dto);
  }
}
