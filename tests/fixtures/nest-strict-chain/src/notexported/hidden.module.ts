import { Module } from '@nestjs/common';
import { HiddenService } from './hidden.service';

@Module({ providers: [HiddenService] })
export class HiddenModule {}
