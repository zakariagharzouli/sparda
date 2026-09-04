import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Mark } from './mark.entity';
import { FactoryController } from './factory.controller';
import { MarkService } from './mark.service';

@Module({
  imports: [TypeOrmModule.forFeature([Mark])],
  controllers: [FactoryController],
  // `useFactory` — the source states a RECIPE, not a class. One non-literal
  // entry makes the whole binding set a container decision.
  providers: [{ provide: MarkService, useFactory: () => new MarkService(null) }],
})
export class FactoryModule {}
