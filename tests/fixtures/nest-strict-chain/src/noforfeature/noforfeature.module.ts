import { Module } from '@nestjs/common';
import { NoforfeatureController } from './noforfeature.controller';
import { NoforfeatureService } from './noforfeature.service';

@Module({
  controllers: [NoforfeatureController],
  providers: [NoforfeatureService],
})
export class NoforfeatureModule {}
