import { Module } from '@nestjs/common';
import { NotinjectableController } from './notinjectable.controller';
import { NotinjectableService } from './notinjectable.service';

@Module({ controllers: [NotinjectableController], providers: [NotinjectableService] })
export class NotinjectableModule {}
