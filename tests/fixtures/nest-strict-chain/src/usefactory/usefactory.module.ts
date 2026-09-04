import { Module } from '@nestjs/common';
import { UsefactoryController } from './usefactory.controller';
import { UsefactoryService } from './usefactory.service';

@Module({
  controllers: [UsefactoryController],
  providers: [{ provide: UsefactoryService, useFactory: () => new UsefactoryService(null) }],
})
export class UsefactoryModule {}
