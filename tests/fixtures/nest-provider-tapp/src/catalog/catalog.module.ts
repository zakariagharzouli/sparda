import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Item } from './item.model';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [SequelizeModule.forFeature([Item])],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
