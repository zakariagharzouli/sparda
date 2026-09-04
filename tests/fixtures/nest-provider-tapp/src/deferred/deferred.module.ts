import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Note } from './note.entity';
import { DeferredController } from './deferred.controller';
import { DeferredService } from './deferred.service';

@Module({
  imports: [TypeOrmModule.forFeature([Note])],
  controllers: [DeferredController],
  providers: [DeferredService],
})
export class DeferredModule {}
