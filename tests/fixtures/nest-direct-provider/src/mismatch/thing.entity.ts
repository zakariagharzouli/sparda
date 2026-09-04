import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Thing {
  @PrimaryGeneratedColumn() id: number;
  @Column() label: string;
}
