import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Box {
  @PrimaryGeneratedColumn() id: number;
  @Column() size: number;
}
