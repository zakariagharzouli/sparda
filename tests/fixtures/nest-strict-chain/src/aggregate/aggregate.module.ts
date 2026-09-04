import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Row } from './row.entity';
import { AggregateController } from './aggregate.controller';
import { AggregateService } from './aggregate.service';

const PROVIDERS = [AggregateService];

@Module({
  imports: [TypeOrmModule.forFeature([Row])],
  controllers: [AggregateController], providers: [...PROVIDERS] })
export class AggregateModule {}
