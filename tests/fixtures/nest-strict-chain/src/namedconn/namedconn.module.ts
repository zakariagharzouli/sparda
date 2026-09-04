import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NamedconnController } from './namedconn.controller';
import { NamedconnService } from './namedconn.service';
import { Row } from './row.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Row])],
  controllers: [NamedconnController],
  providers: [NamedconnService],
})
export class NamedconnModule {}
