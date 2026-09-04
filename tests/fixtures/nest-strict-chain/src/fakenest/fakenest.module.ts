import { Module } from '@nestjs/common';
import { FakeNestController } from './fakenest.controller';
import { FakeNestService } from './fakenest.service';

@Module({ controllers: [FakeNestController], providers: [FakeNestService] })
export class FakeNestModule {}
