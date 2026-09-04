import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Hit {
  @PrimaryGeneratedColumn() id: number;
  @Column() count: number;
}
