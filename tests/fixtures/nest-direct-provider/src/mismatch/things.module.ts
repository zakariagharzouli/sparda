import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Other } from './other.entity';
import { ThingsController } from './things.controller';
import { ThingsService } from './things.service';

@Module({
  // the module registers Other; the service injects Thing. The repository this
  // service actually receives is NOT the one this module declares.
  imports: [TypeOrmModule.forFeature([Other])],
  controllers: [ThingsController],
  providers: [ThingsService],
})
export class ThingsModule {}
