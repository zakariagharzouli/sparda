import { Module } from '@nestjs/common';
import { Depth4Controller } from './depth4.controller';
import { FourOneService } from './four-one.service';
import { FourTwoService } from './four-two.service';
import { FourThreeService } from './four-three.service';
import { FourFourService } from './four-four.service';

@Module({
  controllers: [Depth4Controller],
  providers: [FourOneService, FourTwoService, FourThreeService, FourFourService],
})
export class Depth4Module {}
