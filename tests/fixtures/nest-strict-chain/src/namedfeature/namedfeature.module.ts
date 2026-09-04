import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NamedfeatureController } from './namedfeature.controller';
import { NamedfeatureService } from './namedfeature.service';
import { Row } from './row.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Row], 'analytics')],
  controllers: [NamedfeatureController],
  providers: [NamedfeatureService],
})
export class NamedfeatureModule {}
