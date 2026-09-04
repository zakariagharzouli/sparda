import { Module } from '@nestjs/common';
import { NobindingController } from './nobinding.controller';

@Module({ controllers: [NobindingController], providers: [] })
export class NobindingModule {}
