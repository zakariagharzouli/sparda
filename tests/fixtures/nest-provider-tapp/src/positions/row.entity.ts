import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Row {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
}
