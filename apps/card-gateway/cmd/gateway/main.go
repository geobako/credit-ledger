// Command gateway runs the card-network-facing authorization gateway.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/acme-credit/card-gateway/internal/breaker"
	"github.com/acme-credit/card-gateway/internal/config"
	"github.com/acme-credit/card-gateway/internal/gateway"
	"github.com/acme-credit/card-gateway/internal/lending"
	"github.com/acme-credit/card-gateway/internal/ratelimit"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("service", "card-gateway")
	cfg, err := config.Load()
	if err != nil {
		log.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	// A tight transport: the authorization deadline is the real limit, these are backstops.
	httpClient := &http.Client{
		Timeout: cfg.SettleTimeout,
		Transport: &http.Transport{
			DialContext:         (&net.Dialer{Timeout: 500 * time.Millisecond, KeepAlive: 30 * time.Second}).DialContext,
			MaxIdleConnsPerHost: 64,
			IdleConnTimeout:     90 * time.Second,
		},
	}
	api := lending.NewClient(cfg.LendingAPIURL, []byte(cfg.GatewaySharedSecret), httpClient)
	reverser := gateway.NewReverser(api, log, cfg.ReversalWorkers, 10_000, cfg.ReversalMaxAttempts, func(attempt int) time.Duration {
		return min(30*time.Second, time.Duration(1<<attempt)*250*time.Millisecond)
	})
	server := gateway.NewServer(
		api,
		breaker.New(cfg.BreakerThreshold, cfg.BreakerCooldown, time.Now),
		ratelimit.New(cfg.RateLimitPerSecond, cfg.RateLimitBurst, time.Now),
		reverser,
		log,
		gateway.Options{
			NetworkKey:      cfg.NetworkKey,
			AuthTimeout:     cfg.AuthTimeout,
			SettleTimeout:   cfg.SettleTimeout,
			MaxAmountMinor:  cfg.MaxAmountMinor,
			SettleRetries:   3,
			SettleRetryWait: 100 * time.Millisecond,
		},
	)

	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 2 * time.Second,
		ReadTimeout:       5 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Info("card gateway listening", "port", cfg.Port, "lending_api", cfg.LendingAPIURL)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Info("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
	reverser.Close(ctx)
}
