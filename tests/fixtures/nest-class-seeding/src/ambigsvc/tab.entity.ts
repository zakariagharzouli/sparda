import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Tab {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
}
