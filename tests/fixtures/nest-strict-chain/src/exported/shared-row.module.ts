import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Row } from './row.entity';
import { SharedRowService } from './shared-row.service';

@Module({
  imports: [TypeOrmModule.forFeature([Row])],
  providers: [SharedRowService], exports: [SharedRowService] })
export class SharedRowModule {}
