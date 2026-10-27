// Package ratelimit is a per-key token bucket. The gateway keys it by card token to blunt
// card-testing attacks (bursts of small authorizations against one card) before they reach
// the lending API.
package ratelimit

import (
	"sync"
	"time"
)

type bucket struct {
	tokens float64
	last   time.Time
}

type Limiter struct {
	mu      sync.Mutex
	rate    float64 // tokens per second
	burst   float64
	now     func() time.Time
	buckets map[string]*bucket
	calls   int
}

func New(perSecond float64, burst int, now func() time.Time) *Limiter {
	return &Limiter{rate: perSecond, burst: float64(burst), now: now, buckets: map[string]*bucket{}}
}

func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()

	l.calls++
	if l.calls%1024 == 0 {
		l.sweep(now)
	}

	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens = min(l.burst, b.tokens+now.Sub(b.last).Seconds()*l.rate)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// sweep forgets buckets that have refilled completely: they behave exactly like new ones.
func (l *Limiter) sweep(now time.Time) {
	full := time.Duration(l.burst / l.rate * float64(time.Second))
	for key, b := range l.buckets {
		if now.Sub(b.last) > full {
			delete(l.buckets, key)
		}
	}
}
