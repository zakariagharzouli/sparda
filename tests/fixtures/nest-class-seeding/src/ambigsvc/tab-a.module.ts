import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tab } from './tab.entity';
import { TabAController } from './tab-a.controller';
import { TabService } from './tab.service';

// Each CONTROLLER here is declared by exactly one module. Only the PROVIDER is
// declared twice, so the provider-uniqueness check is the deciding one.
@Module({
  imports: [TypeOrmModule.forFeature([Tab])],
  controllers: [TabAController],
  providers: [TabService],
})
export class TabAModule {}
