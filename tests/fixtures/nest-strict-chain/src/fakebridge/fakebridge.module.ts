import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FakebridgeController } from './fakebridge.controller';
import { FakebridgeService } from './fakebridge.service';
import { Row } from './row.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Row])],
  controllers: [FakebridgeController],
  providers: [FakebridgeService],
})
export class FakebridgeModule {}
