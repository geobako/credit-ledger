package gateway

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/acme-credit/card-gateway/internal/lending"
)

// Reverser compensates authorizations whose outcome is unknown.
//
// When the lending API times out on an authorization, the gateway has already told the
// network "declined" (fail closed). But the API may have approved it and placed a hold the
// customer will never use. So the gateway replays the identical request (the API is
// idempotent on the network transaction id, so it returns the original decision, or makes
// one) and, if it was approved, reverses it. Either way, no hold is left behind.
//
// The queue is in memory: production would use a durable queue (SQS) so that pending
// compensations survive a restart. Unfinished items are logged loudly on shutdown.
type Reverser struct {
	api     LendingAPI
	log     *slog.Logger
	backoff func(attempt int) time.Duration
	maxTry  int

	queue chan lending.AuthorizeRequest
	wg    sync.WaitGroup
	stop  chan struct{}
}

func NewReverser(api LendingAPI, log *slog.Logger, workers, capacity, maxAttempts int, backoff func(int) time.Duration) *Reverser {
	r := &Reverser{
		api: api, log: log, backoff: backoff, maxTry: maxAttempts,
		queue: make(chan lending.AuthorizeRequest, capacity),
		stop:  make(chan struct{}),
	}
	for i := 0; i < workers; i++ {
		r.wg.Add(1)
		go r.work()
	}
	return r
}

// Enqueue schedules compensation. It never blocks the authorization path.
func (r *Reverser) Enqueue(req lending.AuthorizeRequest) {
	select {
	case r.queue <- req:
		metrics.reversalsPending.Add(1)
	default:
		metrics.reversalsDropped.Add(1)
		r.log.Error("timeout-reversal queue full: authorization needs manual review",
			"network_transaction_id", req.NetworkTransactionID)
	}
}

// Close stops the workers, waiting up to ctx for in-flight compensations.
func (r *Reverser) Close(ctx context.Context) {
	close(r.stop)
	done := make(chan struct{})
	go func() { r.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
	}
	for {
		select {
		case req := <-r.queue:
			r.log.Error("unresolved timeout reversal at shutdown: needs manual review",
				"network_transaction_id", req.NetworkTransactionID)
		default:
			return
		}
	}
}

func (r *Reverser) work() {
	defer r.wg.Done()
	for {
		select {
		case <-r.stop:
			return
		case req := <-r.queue:
			r.compensate(req)
			metrics.reversalsPending.Add(-1)
		}
	}
}

func (r *Reverser) compensate(req lending.AuthorizeRequest) {
	log := r.log.With("network_transaction_id", req.NetworkTransactionID)
	for attempt := 1; attempt <= r.maxTry; attempt++ {
		done, err := r.attempt(req)
		if done {
			metrics.reversalsCompleted.Add(1)
			return
		}
		var apiErr *lending.APIError
		if errors.As(err, &apiErr) && apiErr.Status != 409 {
			log.Error("timeout reversal refused by lending API", "error", err)
			metrics.reversalsFailed.Add(1)
			return
		}
		log.Warn("timeout reversal attempt failed", "attempt", attempt, "error", err)
		select {
		case <-time.After(r.backoff(attempt)):
		case <-r.stop:
			log.Error("timeout reversal interrupted by shutdown: needs manual review")
			metrics.reversalsFailed.Add(1)
			return
		}
	}
	log.Error("timeout reversal gave up: needs manual review")
	metrics.reversalsFailed.Add(1)
}

// attempt returns done=true once no hold can remain for this network transaction.
func (r *Reverser) attempt(req lending.AuthorizeRequest) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	decision, err := r.api.Authorize(ctx, req)
	if err != nil {
		return false, err
	}
	if !decision.Approved || decision.AuthorizationID == nil {
		return true, nil
	}
	auth, err := r.api.Reverse(ctx, *decision.AuthorizationID)
	if err != nil {
		var apiErr *lending.APIError
		// Already resolved some other way (e.g. expired): nothing left to release.
		if errors.As(err, &apiErr) && apiErr.Status == 409 {
			return true, nil
		}
		return false, err
	}
	r.log.Info("timeout reversal completed", "network_transaction_id", req.NetworkTransactionID, "status", auth.Status)
	return true, nil
}
