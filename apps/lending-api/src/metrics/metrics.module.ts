import { Controller, Get, Global, Header, Module } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators';
import { Metrics } from './metrics';

/**
 * Prometheus scrape endpoint. Unauthenticated like /health; in the cloud it is only reachable
 * from inside the VPC (the load balancer does not route it).
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('metrics')
class MetricsController {
  constructor(private readonly metrics: Metrics) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  scrape() {
    return this.metrics.registry.metrics();
  }
}

@Global()
@Module({
  controllers: [MetricsController],
  providers: [Metrics],
  exports: [Metrics],
})
export class MetricsModule {}
