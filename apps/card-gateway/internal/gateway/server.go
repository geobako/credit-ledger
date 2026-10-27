// Package gateway is the card-network-facing edge: it validates network messages, protects
// the lending API (per-card rate limits, circuit breaker, strict deadlines) and translates
// decisions into network response codes. It holds no balances; the lending API decides.
package gateway

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"expvar"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/acme-credit/card-gateway/internal/breaker"
	"github.com/acme-credit/card-gateway/internal/lending"
	"github.com/acme-credit/card-gateway/internal/ratelimit"
)

// LendingAPI is the subset of the lending client the gateway uses.
type LendingAPI interface {
	Authorize(ctx context.Context, req lending.AuthorizeRequest) (lending.Decision, error)
	Capture(ctx context.Context, authorizationID string, amount *int64) (lending.Authorization, error)
	Reverse(ctx context.Context, authorizationID string) (lending.Authorization, error)
}

type Options struct {
	NetworkKey      string
	AuthTimeout     time.Duration
	SettleTimeout   time.Duration
	MaxAmountMinor  int64
	SettleRetries   int
	SettleRetryWait time.Duration
}

type Server struct {
	api      LendingAPI
	breaker  *breaker.Breaker
	limiter  *ratelimit.Limiter
	reverser *Reverser
	standIns *standIns
	log      *slog.Logger
	opts     Options
}

func NewServer(api LendingAPI, b *breaker.Breaker, l *ratelimit.Limiter, r *Reverser, log *slog.Logger, opts Options) *Server {
	return &Server{api: api, breaker: b, limiter: l, reverser: r, log: log, opts: opts,
		standIns: newStandIns(24*time.Hour, time.Now)}
}

// Handler returns the gateway's routes wrapped in its middleware.
func (s *Server) Handler() http.Handler {
	network := http.NewServeMux()
	network.HandleFunc("POST /v1/authorizations", s.authorize)
	network.HandleFunc("POST /v1/authorizations/{id}/capture", s.capture)
	network.HandleFunc("POST /v1/authorizations/{id}/reversal", s.reverse)

	root := http.NewServeMux()
	root.Handle("/v1/", s.requireNetworkKey(network))
	root.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	root.HandleFunc("GET /readyz", func(w http.ResponseWriter, _ *http.Request) {
		// Ready even with the breaker open: declining (fail closed) is correct behaviour.
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "breaker": string(s.breaker.State())})
	})
	root.Handle("GET /debug/vars", expvar.Handler())
	return s.withRequestContext(root)
}

// ── Network message formats ─────────────────────────────────────────────────

type authorizeMessage struct {
	NetworkTransactionID string `json:"network_transaction_id"`
	CardToken            string `json:"card_token"`
	Amount               int64  `json:"amount"`
	Currency             string `json:"currency"`
	Merchant             struct {
		Name string `json:"name"`
		MCC  string `json:"mcc"`
	} `json:"merchant"`
}

type authorizeResponse struct {
	NetworkTransactionID string  `json:"network_transaction_id"`
	Approved             bool    `json:"approved"`
	ResponseCode         string  `json:"response_code"`
	AuthorizationID      *string `json:"authorization_id"`
	Reason               string  `json:"reason,omitempty"`
}

var (
	transactionIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{8,64}$`)
	cardTokenPattern     = regexp.MustCompile(`^tok_[0-9a-f]{32}$`)
	mccPattern           = regexp.MustCompile(`^\d{4}$`)
	uuidPattern          = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

func (s *Server) validate(m authorizeMessage) string {
	switch {
	case !transactionIDPattern.MatchString(m.NetworkTransactionID):
		return "network_transaction_id must be 8-64 characters of [A-Za-z0-9_.:-]"
	case !cardTokenPattern.MatchString(m.CardToken):
		return "card_token is malformed"
	case m.Amount <= 0 || m.Amount > s.opts.MaxAmountMinor:
		return "amount must be a positive integer of minor units within the gateway limit"
	case m.Currency != "USD":
		return "currency must be USD"
	case m.Merchant.Name == "" || len(m.Merchant.Name) > 120:
		return "merchant.name is required (max 120 characters)"
	case m.Merchant.MCC != "" && !mccPattern.MatchString(m.Merchant.MCC):
		return "merchant.mcc must be 4 digits"
	}
	return ""
}

// ── Handlers ────────────────────────────────────────────────────────────────

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) {
	var msg authorizeMessage
	if err := decodeJSON(w, r, &msg); err != nil {
		s.respondAuthorization(w, r, http.StatusBadRequest, authorizeResponse{ResponseCode: CodeFormatError, Reason: err.Error()})
		return
	}
	if problem := s.validate(msg); problem != "" {
		s.respondAuthorization(w, r, http.StatusBadRequest, authorizeResponse{
			NetworkTransactionID: msg.NetworkTransactionID, ResponseCode: CodeFormatError, Reason: problem,
		})
		return
	}
	decline := func(code, reason string) {
		s.respondAuthorization(w, r, http.StatusOK, authorizeResponse{
			NetworkTransactionID: msg.NetworkTransactionID, ResponseCode: code, Reason: reason,
		})
	}

	if s.standIns.has(msg.NetworkTransactionID) {
		decline(CodeIssuerUnavailable, "ISSUER_UNAVAILABLE")
		return
	}
	if !s.limiter.Allow(msg.CardToken) {
		metrics.rateLimited.Add(1)
		decline(CodeFrequencyExceeded, "RATE_LIMITED")
		return
	}
	if !s.breaker.Allow() {
		// Nothing was sent, so nothing needs compensating.
		metrics.breakerRejections.Add(1)
		decline(CodeIssuerUnavailable, "ISSUER_UNAVAILABLE")
		return
	}

	req := lending.AuthorizeRequest{
		NetworkTransactionID: msg.NetworkTransactionID,
		CardToken:            msg.CardToken,
		Amount:               strconv.FormatInt(msg.Amount, 10),
		Currency:             msg.Currency,
		MerchantName:         msg.Merchant.Name,
		MerchantCategoryCode: msg.Merchant.MCC,
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.opts.AuthTimeout)
	defer cancel()
	decision, err := s.api.Authorize(ctx, req)

	var apiErr *lending.APIError
	switch {
	case err == nil:
		s.breaker.Success()
		res := authorizeResponse{
			NetworkTransactionID: msg.NetworkTransactionID,
			Approved:             decision.Approved,
			ResponseCode:         CodeApproved,
			AuthorizationID:      decision.AuthorizationID,
		}
		if !decision.Approved && decision.DeclineReason != nil {
			res.ResponseCode, res.Reason = declineCode(*decision.DeclineReason), *decision.DeclineReason
		}
		s.respondAuthorization(w, r, http.StatusOK, res)

	case lending.IsUnavailable(err):
		// Fail closed: decline now, and make sure no hold survives if the API did approve.
		s.breaker.Failure()
		metrics.lendingUnavailable.Add(1)
		s.log.Warn("lending API unavailable during authorization; declining and compensating",
			"network_transaction_id", msg.NetworkTransactionID, "error", err)
		s.standIns.add(msg.NetworkTransactionID)
		s.reverser.Enqueue(req)
		decline(CodeIssuerUnavailable, "ISSUER_UNAVAILABLE")

	case errors.As(err, &apiErr) && apiErr.Code == "IDEMPOTENCY_KEY_REUSED":
		s.breaker.Success()
		decline(CodeDuplicateTransmission, "DUPLICATE_TRANSACTION_ID")

	default:
		// A 4xx we should never trigger (bad signature, validation drift): a gateway bug.
		s.breaker.Success()
		s.log.Error("lending API rejected an authorization request", "error", err)
		decline(CodeIssuerUnavailable, "ISSUER_ERROR")
	}
}

func (s *Server) capture(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Amount *int64 `json:"amount"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &body); err != nil {
			writeProblem(w, http.StatusBadRequest, "FORMAT_ERROR", err.Error())
			return
		}
	}
	if body.Amount != nil && (*body.Amount <= 0 || *body.Amount > s.opts.MaxAmountMinor) {
		writeProblem(w, http.StatusBadRequest, "FORMAT_ERROR", "amount must be a positive integer of minor units")
		return
	}
	s.settle(w, r, id, func(ctx context.Context) (lending.Authorization, error) {
		return s.api.Capture(ctx, id, body.Amount)
	})
}

func (s *Server) reverse(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.settle(w, r, id, func(ctx context.Context) (lending.Authorization, error) {
		return s.api.Reverse(ctx, id)
	})
}

// settle runs a capture or reversal. Both are idempotent in the lending API, so transient
// failures are retried within the deadline; a definitive answer is passed through.
func (s *Server) settle(w http.ResponseWriter, r *http.Request, id string, call func(context.Context) (lending.Authorization, error)) {
	if !uuidPattern.MatchString(id) {
		writeProblem(w, http.StatusBadRequest, "FORMAT_ERROR", "authorization id must be a UUID")
		return
	}
	if !s.breaker.Allow() {
		metrics.breakerRejections.Add(1)
		writeProblem(w, http.StatusServiceUnavailable, "ISSUER_UNAVAILABLE", "retry later")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.opts.SettleTimeout)
	defer cancel()

	var err error
	for attempt := 1; attempt <= s.opts.SettleRetries; attempt++ {
		var auth lending.Authorization
		if auth, err = call(ctx); err == nil {
			s.breaker.Success()
			writeJSON(w, http.StatusOK, auth)
			return
		}
		if !lending.IsUnavailable(err) || ctx.Err() != nil {
			break
		}
		select {
		case <-time.After(s.opts.SettleRetryWait * time.Duration(attempt)):
		case <-ctx.Done():
		}
	}

	var apiErr *lending.APIError
	if errors.As(err, &apiErr) {
		s.breaker.Success()
		writeProblem(w, apiErr.Status, apiErr.Code, apiErr.Detail)
		return
	}
	s.breaker.Failure()
	metrics.lendingUnavailable.Add(1)
	s.log.Warn("lending API unavailable during settlement", "authorization_id", id, "error", err)
	writeProblem(w, http.StatusServiceUnavailable, "ISSUER_UNAVAILABLE", "retry later")
}

func (s *Server) respondAuthorization(w http.ResponseWriter, r *http.Request, status int, res authorizeResponse) {
	metrics.responses.Add(res.ResponseCode, 1)
	s.log.InfoContext(r.Context(), "authorization",
		"network_transaction_id", res.NetworkTransactionID,
		"response_code", res.ResponseCode,
		"reason", res.Reason,
		"request_id", lending.RequestID(r.Context()))
	writeJSON(w, status, res)
}

// ── Middleware & helpers ────────────────────────────────────────────────────

func (s *Server) requireNetworkKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// In production this is mutual TLS with the card network; a key stands in for it here.
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Network-Key")), []byte(s.opts.NetworkKey)) != 1 {
			writeProblem(w, http.StatusUnauthorized, "UNAUTHENTICATED", "invalid network credentials")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) withRequestContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if id == "" || len(id) > 128 {
			buf := make([]byte, 16)
			_, _ = rand.Read(buf)
			id = hex.EncodeToString(buf)
		}
		w.Header().Set("X-Request-Id", id)
		defer func() {
			if rec := recover(); rec != nil {
				s.log.Error("panic serving request", "panic", rec, "request_id", id)
				writeProblem(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			}
		}()
		next.ServeHTTP(w, r.WithContext(lending.WithRequestID(r.Context(), id)))
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, out any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return errors.New("malformed JSON body")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeProblem(w http.ResponseWriter, status int, code, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "code": code, "detail": detail})
}
