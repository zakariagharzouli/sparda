import { Module } from '@nestjs/common';
import { IncongruentController } from './incongruent.controller';
import { IncongruentService } from './incongruent.service';
import { OtherService } from './other.service';

@Module({
  controllers: [IncongruentController],
  providers: [IncongruentService, OtherService],
})
export class IncongruentModule {}
