import { Entity, Column } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum InstitutionTier {
  STANDARD = 'standard',
  PREMIUM = 'premium',
  SOVEREIGN = 'sovereign',
}

@Entity('institution_configs')
export class InstitutionConfig extends BaseEntity {
  @ApiProperty({ description: 'Entity ID of the institutional facilitator' })
  @Column({ type: 'uuid', unique: true })
  entityId: string;

  @ApiProperty({ enum: InstitutionTier, default: InstitutionTier.STANDARD })
  @Column({ type: 'enum', enum: InstitutionTier, default: InstitutionTier.STANDARD })
  tier: InstitutionTier;

  @ApiProperty({ description: 'Maximum QP this institution may mint (from global 500T cap)' })
  @Column({ type: 'bigint', default: 0 })
  issueCap: number;

  @ApiProperty({ description: 'Total QP minted so far by this institution' })
  @Column({ type: 'bigint', default: 0 })
  mintedSupply: number;

  @ApiProperty({ description: 'Facility fee rate applied on inter-entity settlement (0–1)' })
  @Column({ type: 'decimal', precision: 6, scale: 5, default: 0.001 })
  facilityFeeRate: number;

  @ApiProperty({ description: 'Whether institutional issuance is active' })
  @Column({ default: false })
  isActive: boolean;

  @ApiProperty({ description: 'KYB/AML verification status' })
  @Column({ default: false })
  dueDiligenceCleared: boolean;

  @ApiProperty({ description: 'Last net-settlement timestamp', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  lastSettlementAt: Date | null;
}
