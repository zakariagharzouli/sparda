import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CatController } from './mongoose.controller';
import { CatService } from './cat.service';
import { Cat } from './cat.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Cat.name, schema: {} }])],
  controllers: [CatController],
  providers: [CatService],
})
export class CatModule {}
