import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Item } from './item.model';

@Injectable()
export class CatalogService {
  constructor(
    @InjectModel(Item)
    private readonly model: typeof Item,
  ) {}

  // Sequelize: `update(values, options)` — values FIRST. TypeORM's `update` is
  // `(criteria, partialEntity)` — criteria first. Same call shape, opposite roles.
  edit(id: string, dto: any) {
    return this.model.update(dto, { where: { id } });
  }
}
