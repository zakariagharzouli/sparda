import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Mark } from './mark.entity';
import { SurfacesController } from './surfaces.controller';
import { SurfacesService } from './surfaces.service';

@Module({
  imports: [TypeOrmModule.forFeature([Mark])],
  controllers: [SurfacesController],
  providers: [SurfacesService],
})
export class SurfacesModule {}
