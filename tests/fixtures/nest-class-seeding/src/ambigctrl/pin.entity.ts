import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Pin {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
}
