import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Doc } from './doc.entity';
import { ReboundController } from './rebound.controller';
import { ReboundService } from './rebound.service';

@Module({
  imports: [TypeOrmModule.forFeature([Doc])],
  controllers: [ReboundController],
  providers: [ReboundService],
})
export class ReboundModule {}
