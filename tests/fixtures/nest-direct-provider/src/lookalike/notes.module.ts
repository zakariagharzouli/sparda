import { Module } from '@nestjs/common';
// the LOCAL lookalike, not @nestjs/typeorm
import { TypeOrmModule } from './fake-typeorm';
import { Note } from './note.entity';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Note])],
  controllers: [NotesController],
  providers: [NotesService],
})
export class NotesModule {}
