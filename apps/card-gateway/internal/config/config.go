// Package config loads the gateway's configuration from the environment and refuses to
// start on anything missing or unsafe.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port                string
	LendingAPIURL       string
	GatewaySharedSecret string
	NetworkKey          string
	AuthTimeout         time.Duration
	SettleTimeout       time.Duration
	BreakerThreshold    int
	BreakerCooldown     time.Duration
	RateLimitPerSecond  float64
	RateLimitBurst      int
	MaxAmountMinor      int64
	ReversalWorkers     int
	ReversalMaxAttempts int
}

func Load() (Config, error) {
	var errs []error
	str := func(key, fallback string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		if fallback == "" {
			errs = append(errs, fmt.Errorf("%s is required", key))
		}
		return fallback
	}
	num := func(key string, fallback int64) int64 {
		v := os.Getenv(key)
		if v == "" {
			return fallback
		}
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			errs = append(errs, fmt.Errorf("%s must be a non-negative integer", key))
		}
		return n
	}

	c := Config{
		Port:                str("PORT", "8081"),
		LendingAPIURL:       str("LENDING_API_URL", ""),
		GatewaySharedSecret: str("GATEWAY_SHARED_SECRET", ""),
		NetworkKey:          str("NETWORK_API_KEY", ""),
		AuthTimeout:         time.Duration(num("AUTH_TIMEOUT_MS", 1500)) * time.Millisecond,
		SettleTimeout:       time.Duration(num("SETTLE_TIMEOUT_MS", 5000)) * time.Millisecond,
		BreakerThreshold:    int(num("BREAKER_THRESHOLD", 5)),
		BreakerCooldown:     time.Duration(num("BREAKER_COOLDOWN_MS", 10_000)) * time.Millisecond,
		RateLimitPerSecond:  float64(num("RATE_LIMIT_PER_CARD_PER_MINUTE", 30)) / 60,
		RateLimitBurst:      int(num("RATE_LIMIT_PER_CARD_BURST", 10)),
		MaxAmountMinor:      num("MAX_AUTHORIZATION_MINOR", 1_000_000),
		ReversalWorkers:     int(num("REVERSAL_WORKERS", 2)),
		ReversalMaxAttempts: int(num("REVERSAL_MAX_ATTEMPTS", 10)),
	}
	if u, err := url.Parse(c.LendingAPIURL); c.LendingAPIURL != "" && (err != nil || u.Scheme == "" || u.Host == "") {
		errs = append(errs, errors.New("LENDING_API_URL must be an absolute URL"))
	}
	if len(c.GatewaySharedSecret) < 32 {
		errs = append(errs, errors.New("GATEWAY_SHARED_SECRET must be at least 32 characters"))
	}
	if len(c.NetworkKey) < 16 {
		errs = append(errs, errors.New("NETWORK_API_KEY must be at least 16 characters"))
	}
	if c.BreakerThreshold < 1 || c.RateLimitBurst < 1 || c.ReversalWorkers < 1 || c.ReversalMaxAttempts < 1 {
		errs = append(errs, errors.New("breaker threshold, rate-limit burst and reversal settings must be >= 1"))
	}
	return c, errors.Join(errs...)
}
