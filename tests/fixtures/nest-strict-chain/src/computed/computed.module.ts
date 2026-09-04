import { Module } from '@nestjs/common';
import { ComputedController } from './computed.controller';
import { ComputedService } from './computed.service';

@Module({ controllers: [ComputedController], providers: [ComputedService] })
export class ComputedModule {}
