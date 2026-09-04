import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Leaf } from './leaf.entity';
import { UnplaceableController } from './unplaceable.controller';
import { UnplaceableService } from './unplaceable.service';

@Module({
  imports: [TypeOrmModule.forFeature([Leaf])],
  controllers: [UnplaceableController],
  providers: [UnplaceableService],
})
export class UnplaceableModule {}
