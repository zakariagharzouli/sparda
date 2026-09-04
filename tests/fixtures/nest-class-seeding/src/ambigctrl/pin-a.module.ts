import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pin } from './pin.entity';
import { PinController } from './pin.controller';
import { PinAService } from './pin-a.service';

// Each PROVIDER here is declared by exactly one module. Only the CONTROLLER is
// declared twice, so the controller-uniqueness check is the deciding one.
@Module({
  imports: [TypeOrmModule.forFeature([Pin])],
  controllers: [PinController],
  providers: [PinAService],
})
export class PinAModule {}
