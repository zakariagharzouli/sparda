import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Row } from './row.entity';
import { Depth3Controller } from './depth3.controller';
import { HopOneService } from './hop-one.service';
import { HopTwoService } from './hop-two.service';
import { HopThreeService } from './hop-three.service';

@Module({
  imports: [TypeOrmModule.forFeature([Row])],
  controllers: [Depth3Controller],
  providers: [HopOneService, HopTwoService, HopThreeService],
})
export class Depth3Module {}
