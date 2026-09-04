import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  findOne(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  save(name: string) {
    return this.repo.save({ name });
  }
}
