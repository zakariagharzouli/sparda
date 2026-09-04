import { Module } from '@nestjs/common';
import { StrtokenController } from './strtoken.controller';
import { StrtokenService } from './strtoken.service';

@Module({ controllers: [StrtokenController], providers: [StrtokenService] })
export class StrtokenModule {}
