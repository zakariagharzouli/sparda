import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Thing } from './thing.entity';
import { SharedController } from './shared.controller';
import { SharedService } from './shared.service';

@Module({
  imports: [TypeOrmModule.forFeature([Thing])],
  controllers: [SharedController],
  providers: [SharedService],
})
export class SharedModule {}
