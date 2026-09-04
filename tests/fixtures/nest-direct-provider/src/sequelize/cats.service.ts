import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Cat } from './cat.model';

@Injectable()
export class CatsService {
  constructor(
    @InjectModel(Cat)
    private readonly catModel: typeof Cat,
  ) {}

  findAll(owner: string) {
    return this.catModel.findAll({ where: { owner } });
  }

  create(name: string) {
    return this.catModel.create({ name });
  }
}
