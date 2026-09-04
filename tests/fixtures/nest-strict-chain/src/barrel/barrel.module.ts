import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Row } from './row.entity';
import { BarrelController } from './barrel.controller';
import { BarrelService } from './services';

@Module({
  imports: [TypeOrmModule.forFeature([Row])],
  controllers: [BarrelController], providers: [BarrelService] })
export class BarrelModule {}
