import { Module } from '@nestjs/common';
import { FakeinjectableController } from './fakeinjectable.controller';
import { FakeinjectableService } from './fakeinjectable.service';

@Module({ controllers: [FakeinjectableController], providers: [FakeinjectableService] })
export class FakeinjectableModule {}
