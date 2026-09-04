import { Module } from '@nestjs/common';
import { MongooseModule } from './mongoose-lookalike';
import { FoxController } from './fakemongoose.controller';
import { FoxService } from './fox.service';
import { Fox } from './fox.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Fox.name, schema: {} }])],
  controllers: [FoxController],
  providers: [FoxService],
})
export class FoxModule {}
