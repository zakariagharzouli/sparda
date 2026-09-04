import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Box } from './box.entity';
// A tsconfig path ALIAS, not an exact relative import. It RESOLVES — which is
// exactly why the check has to be about what was written, not about whether the
// resolver found a file. This is twenty's convention across its whole server.
import { BoxesController } from 'app/aliased/boxes.controller';
import { BoxesService } from 'app/aliased/boxes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Box])],
  controllers: [BoxesController],
  providers: [BoxesService],
})
export class BoxesModule {}
