package ratelimit

import (
	"testing"
	"time"
)

func TestBurstThenRefill(t *testing.T) {
	now := time.Unix(0, 0)
	l := New(2, 3, func() time.Time { return now })

	for i := 0; i < 3; i++ {
		if !l.Allow("card-a") {
			t.Fatalf("request %d within the burst was rejected", i)
		}
	}
	if l.Allow("card-a") {
		t.Fatal("request beyond the burst was allowed")
	}
	if !l.Allow("card-b") {
		t.Fatal("cards must not share a bucket")
	}

	now = now.Add(500 * time.Millisecond) // refills one token at 2/s
	if !l.Allow("card-a") || l.Allow("card-a") {
		t.Fatal("expected exactly one refilled token")
	}
}

func TestSweepForgetsIdleBuckets(t *testing.T) {
	now := time.Unix(0, 0)
	l := New(1, 1, func() time.Time { return now })
	l.Allow("idle")
	now = now.Add(time.Hour)
	for i := 0; i < 1024; i++ {
		l.Allow("busy")
	}
	if _, ok := l.buckets["idle"]; ok {
		t.Fatal("idle bucket should have been swept")
	}
}
