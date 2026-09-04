import { Module } from '@nestjs/common';
import { BadopController } from './badop.controller';
import { BadopService } from './badop.service';

@Module({ controllers: [BadopController], providers: [BadopService] })
export class BadopModule {}
