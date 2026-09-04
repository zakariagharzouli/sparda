import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pin } from './pin.entity';
import { LookalikeController } from './lookalike.controller';
import { LookalikeService } from './lookalike.service';

@Module({
  imports: [TypeOrmModule.forFeature([Pin])],
  controllers: [LookalikeController],
  providers: [LookalikeService],
})
export class LookalikeModule {}
