package breaker

import (
	"testing"
	"time"
)

func TestBreakerLifecycle(t *testing.T) {
	now := time.Unix(0, 0)
	b := New(3, 10*time.Second, func() time.Time { return now })

	for i := 0; i < 2; i++ {
		b.Failure()
	}
	if !b.Allow() || b.State() != Closed {
		t.Fatal("should stay closed below the threshold")
	}
	b.Failure()
	if b.Allow() || b.State() != Open {
		t.Fatal("should open at the threshold and reject calls")
	}

	now = now.Add(10 * time.Second)
	if !b.Allow() || b.State() != HalfOpen {
		t.Fatal("should let one probe through after the cool-down")
	}
	if b.Allow() {
		t.Fatal("should allow only a single probe while half-open")
	}
	b.Failure()
	if b.State() != Open || b.Allow() {
		t.Fatal("a failed probe re-opens the breaker")
	}

	now = now.Add(10 * time.Second)
	b.Allow()
	b.Success()
	if b.State() != Closed || !b.Allow() {
		t.Fatal("a successful probe closes the breaker")
	}
}

func TestSuccessResetsFailureCount(t *testing.T) {
	b := New(3, time.Second, time.Now)
	b.Failure()
	b.Failure()
	b.Success()
	b.Failure()
	b.Failure()
	if b.State() != Closed {
		t.Fatal("failures must be consecutive to open the breaker")
	}
}
