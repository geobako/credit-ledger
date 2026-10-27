package gateway

import (
	"sync"
	"time"
)

// standIns remembers network transactions the gateway declined on the issuer's behalf
// because the lending API's outcome was unknown. If the network retransmits one, the answer
// must stay "declined": replaying it to the API could return the original approval for a
// hold that the Reverser is about to release.
type standIns struct {
	mu      sync.Mutex
	ttl     time.Duration
	now     func() time.Time
	entries map[string]time.Time
}

func newStandIns(ttl time.Duration, now func() time.Time) *standIns {
	return &standIns{ttl: ttl, now: now, entries: map[string]time.Time{}}
}

func (s *standIns) add(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for key, at := range s.entries {
		if now.Sub(at) > s.ttl {
			delete(s.entries, key)
		}
	}
	s.entries[id] = now
}

func (s *standIns) has(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	at, ok := s.entries[id]
	return ok && s.now().Sub(at) <= s.ttl
}
