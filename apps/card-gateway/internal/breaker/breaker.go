// Package breaker is a small circuit breaker. When the lending API keeps failing, the gateway
// stops calling it for a cool-down period and declines immediately (fail closed), instead of
// piling more load and latency onto a struggling dependency.
package breaker

import (
	"sync"
	"time"
)

type State string

const (
	Closed   State = "closed"
	Open     State = "open"
	HalfOpen State = "half-open"
)

type Breaker struct {
	mu        sync.Mutex
	threshold int
	cooldown  time.Duration
	now       func() time.Time

	state    State
	failures int
	openedAt time.Time
	probing  bool
}

func New(threshold int, cooldown time.Duration, now func() time.Time) *Breaker {
	return &Breaker{threshold: threshold, cooldown: cooldown, now: now, state: Closed}
}

// Allow reports whether a call may go through. After the cool-down a single probe is let
// through (half-open); its outcome closes or re-opens the breaker.
func (b *Breaker) Allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	switch b.state {
	case Closed:
		return true
	case Open:
		if b.now().Sub(b.openedAt) < b.cooldown {
			return false
		}
		b.state = HalfOpen
		b.probing = true
		return true
	default: // half-open: only the one probe in flight
		if b.probing {
			return false
		}
		b.probing = true
		return true
	}
}

func (b *Breaker) Success() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.state, b.failures, b.probing = Closed, 0, false
}

func (b *Breaker) Failure() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.failures++
	if b.state == HalfOpen || b.failures >= b.threshold {
		b.state, b.openedAt, b.probing = Open, b.now(), false
	}
}

func (b *Breaker) State() State {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.state
}
