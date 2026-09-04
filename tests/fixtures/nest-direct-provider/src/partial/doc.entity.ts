import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Doc {
  @PrimaryGeneratedColumn() id: number;
  @Column() title: string;
}
