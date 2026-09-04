import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntitymismatchController } from './entitymismatch.controller';
import { EntitymismatchService } from './entitymismatch.service';
import { Other } from './other.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Other])],
  controllers: [EntitymismatchController],
  providers: [EntitymismatchService],
})
export class EntitymismatchModule {}
