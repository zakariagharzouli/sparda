import { Module, forwardRef } from '@nestjs/common';
import { ForwardrefController } from './forwardref.controller';
import { ForwardrefService } from './forwardref.service';

@Module({
  controllers: [ForwardrefController],
  providers: [forwardRef(() => ForwardrefService)],
})
export class ForwardrefModule {}
