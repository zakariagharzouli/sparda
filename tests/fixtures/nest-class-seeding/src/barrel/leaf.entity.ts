import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Leaf {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
}
