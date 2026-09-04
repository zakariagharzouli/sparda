import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Hit } from './hit.entity';
import { HitsController } from './hits.controller';
import { HitsService } from './hits.service';

@Module({
  imports: [TypeOrmModule.forFeature([Hit])],
  controllers: [HitsController],
  providers: [HitsService],
})
export class HitsModule {}
