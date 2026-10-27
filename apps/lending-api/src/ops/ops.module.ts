import { Module } from '@nestjs/common';
import { OpsController } from './ops.controller';
import { ReconciliationJob } from './reconciliation.job';
import { ReconciliationService } from './reconciliation.service';

@Module({
  controllers: [OpsController],
  providers: [ReconciliationService, ReconciliationJob],
  exports: [ReconciliationService],
})
export class OpsModule {}
