import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mark } from './mark.entity';

@Injectable()
export class SurfacesService {
  constructor(
    @InjectRepository(Mark)
    private readonly repo: Repository<Mark>,
  ) {}

  plain(dto: any) {
    return this.repo.save(dto);
  }

  byId(id: any) {
    return this.repo.findOne({ where: { id } });
  }
}
