import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { UsersModule } from './typeorm/users.module';
import { CatsModule } from './sequelize/cats.module';
import { OrdersModule } from './token/orders.module';
import { ThingsModule } from './mismatch/things.module';
import { NotesModule } from './lookalike/notes.module';
import { DocsModule } from './partial/docs.module';
import { TagsModule } from './injectparam/tags.module';
import { HitsModule } from './vocab/hits.module';
import { BoxesModule } from './aliased/boxes.module';

@Module({
  imports: [
    UsersModule,
    CatsModule,
    OrdersModule,
    ThingsModule,
    NotesModule,
    DocsModule,
    TagsModule,
    HitsModule,
    BoxesModule,
  ],
})
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
