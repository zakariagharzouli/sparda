import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Row } from './row.entity';
import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';

@Module({
  imports: [TypeOrmModule.forFeature([Row])],
  controllers: [PositionsController],
  providers: [PositionsService],
})
export class PositionsModule {}
