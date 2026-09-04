import { Module } from '@nestjs/common';
import { FakeOrmController } from './fakeorm.controller';
import { FakeOrmService } from './fakeorm.service';

@Module({ controllers: [FakeOrmController], providers: [FakeOrmService] })
export class FakeOrmModule {}
