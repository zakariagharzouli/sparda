import { Module } from '@nestjs/common';
import { MutatedController } from './mutated.controller';
import { MutatedService } from './mutated.service';

const PROVIDERS = [MutatedService];
PROVIDERS.push(MutatedService);

@Module({ controllers: [MutatedController], providers: [...PROVIDERS] })
export class MutatedModule {}
