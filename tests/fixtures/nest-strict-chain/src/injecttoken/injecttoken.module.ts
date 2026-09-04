import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Row } from './row.entity';
import { InjectTokenController } from './injecttoken.controller';
import { TokenService } from './token.service';

@Module({
  imports: [TypeOrmModule.forFeature([Row])],
  controllers: [InjectTokenController], providers: [TokenService] })
export class InjectTokenModule {}
