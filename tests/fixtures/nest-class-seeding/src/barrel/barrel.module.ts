import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Leaf } from './leaf.entity';
import { BarrelController } from './barrel.controller';
import { LeafService } from './services';

@Module({
  imports: [TypeOrmModule.forFeature([Leaf])],
  controllers: [BarrelController],
  providers: [LeafService],
})
export class BarrelModule {}
