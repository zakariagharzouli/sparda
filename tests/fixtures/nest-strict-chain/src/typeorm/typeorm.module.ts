import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Row } from './row.entity';
import { TypeormController } from './typeorm.controller';
import { TypeormService } from './typeorm.service';

@Module({
  imports: [TypeOrmModule.forFeature([Row])],
  controllers: [TypeormController], providers: [TypeormService] })
export class TypeormModule {}
