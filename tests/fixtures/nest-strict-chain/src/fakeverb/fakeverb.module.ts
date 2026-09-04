import { Module } from '@nestjs/common';
import { FakeverbController } from './fakeverb.controller';
import { FakeverbService } from './fakeverb.service';

@Module({ controllers: [FakeverbController], providers: [FakeverbService] })
export class FakeverbModule {}
