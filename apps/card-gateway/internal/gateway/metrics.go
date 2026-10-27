package gateway

import "expvar"

// Process metrics, served at /debug/vars (stdlib expvar: no dependencies). Scraped into
// Prometheus with a JSON exporter, or replaced by OpenTelemetry in production.
var metrics = struct {
	responses          *expvar.Map
	lendingUnavailable *expvar.Int
	breakerRejections  *expvar.Int
	rateLimited        *expvar.Int
	reversalsPending   *expvar.Int
	reversalsCompleted *expvar.Int
	reversalsFailed    *expvar.Int
	reversalsDropped   *expvar.Int
}{
	responses:          expvar.NewMap("authorization_responses"),
	lendingUnavailable: expvar.NewInt("lending_unavailable_total"),
	breakerRejections:  expvar.NewInt("breaker_rejections_total"),
	rateLimited:        expvar.NewInt("rate_limited_total"),
	reversalsPending:   expvar.NewInt("timeout_reversals_pending"),
	reversalsCompleted: expvar.NewInt("timeout_reversals_completed_total"),
	reversalsFailed:    expvar.NewInt("timeout_reversals_failed_total"),
	reversalsDropped:   expvar.NewInt("timeout_reversals_dropped_total"),
}
