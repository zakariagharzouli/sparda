import { Module } from '@nestjs/common';
import { DogController } from './mongonobridge.controller';
import { DogService } from './dog.service';

@Module({ controllers: [DogController], providers: [DogService] })
export class DogModule {}
