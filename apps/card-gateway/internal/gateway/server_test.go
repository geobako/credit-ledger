package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/acme-credit/card-gateway/internal/breaker"
	"github.com/acme-credit/card-gateway/internal/lending"
	"github.com/acme-credit/card-gateway/internal/ratelimit"
	"github.com/acme-credit/card-gateway/internal/signing"
)

const (
	sharedSecret = "test-gateway-secret-0123456789-abcdefghij"
	networkKey   = "test-network-key-0123"
	cardToken    = "tok_0123456789abcdef0123456789abcdef"
	authID       = "7d0f1c8e-0000-4000-8000-000000000001"
)

// fakeLending is a stand-in lending API. It rejects anything not correctly signed, records
// calls and lets each test script the responses.
type fakeLending struct {
	t         *testing.T
	mu        sync.Mutex
	calls     []string
	seenNTIDs map[string]bool
	requestID string
	authorize func(call int, body lending.AuthorizeRequest) (int, any)
	settle    func(call int, path string) (int, any)
	authCalls atomic.Int32
	setCalls  atomic.Int32
}

func (f *fakeLending) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	if err := signing.Verify([]byte(sharedSecret), r.Method, r.URL.Path, body, r.Header.Get("X-Signature"), time.Minute, time.Now()); err != nil {
		f.t.Errorf("lending API received a badly signed request to %s", r.URL.Path)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if r.Header.Get("X-Service-Id") != "card-gateway" {
		f.t.Errorf("missing service id")
	}
	f.mu.Lock()
	f.calls = append(f.calls, r.URL.Path)
	f.requestID = r.Header.Get("X-Request-Id")
	f.mu.Unlock()

	var status int
	var res any
	if r.URL.Path == "/v1/network/authorizations" {
		var req lending.AuthorizeRequest
		_ = json.Unmarshal(body, &req)
		f.mu.Lock()
		if f.seenNTIDs == nil {
			f.seenNTIDs = map[string]bool{}
		}
		f.seenNTIDs[req.NetworkTransactionID] = true
		f.mu.Unlock()
		status, res = f.authorize(int(f.authCalls.Add(1)), req)
	} else {
		status, res = f.settle(int(f.setCalls.Add(1)), r.URL.Path)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(res)
}

func (f *fakeLending) paths() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls...)
}

func approved(req lending.AuthorizeRequest) (int, any) {
	id := authID
	return 200, lending.Decision{NetworkTransactionID: req.NetworkTransactionID, AuthorizationID: &id, Approved: true, Status: "HELD"}
}

func declined(reason string) func(int, lending.AuthorizeRequest) (int, any) {
	return func(_ int, req lending.AuthorizeRequest) (int, any) {
		id := authID
		return 200, lending.Decision{NetworkTransactionID: req.NetworkTransactionID, AuthorizationID: &id, Status: "DECLINED", DeclineReason: &reason}
	}
}

type harness struct {
	fake    *fakeLending
	handler http.Handler
	cancel  func()
}

func newHarness(t *testing.T, fake *fakeLending, threshold int) *harness {
	fake.t = t
	if fake.settle == nil {
		fake.settle = func(int, string) (int, any) { return 200, lending.Authorization{ID: authID, Status: "REVERSED"} }
	}
	upstream := httptest.NewServer(fake)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	api := lending.NewClient(upstream.URL, []byte(sharedSecret), upstream.Client())
	reverser := NewReverser(api, log, 1, 100, 5, func(int) time.Duration { return 10 * time.Millisecond })
	server := NewServer(api, breaker.New(threshold, time.Hour, time.Now), ratelimit.New(1, 5, time.Now), reverser, log, Options{
		NetworkKey: networkKey, AuthTimeout: 100 * time.Millisecond, SettleTimeout: time.Second,
		MaxAmountMinor: 1_000_000, SettleRetries: 3, SettleRetryWait: 5 * time.Millisecond,
	})
	h := &harness{fake: fake, handler: server.Handler(), cancel: func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		reverser.Close(ctx)
		upstream.Close()
	}}
	t.Cleanup(h.cancel)
	return h
}

func (h *harness) post(path, body string, headers ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("X-Network-Key", networkKey)
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return rec
}

func authorizeBody(ntid string, amount int64) string {
	b, _ := json.Marshal(map[string]any{
		"network_transaction_id": ntid, "card_token": cardToken, "amount": amount, "currency": "USD",
		"merchant": map[string]string{"name": "Blue Bottle", "mcc": "5814"},
	})
	return string(b)
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) authorizeResponse {
	t.Helper()
	var res authorizeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("bad response %q: %v", rec.Body.String(), err)
	}
	return res
}

func eventually(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestApprovesAndPropagatesTheRequestID(t *testing.T) {
	h := newHarness(t, &fakeLending{authorize: func(_ int, r lending.AuthorizeRequest) (int, any) { return approved(r) }}, 5)
	rec := h.post("/v1/authorizations", authorizeBody("net:approve-1", 1250), "X-Request-Id", "req-abc")

	res := decode(t, rec)
	if rec.Code != 200 || !res.Approved || res.ResponseCode != CodeApproved || res.AuthorizationID == nil {
		t.Fatalf("unexpected response %d %+v", rec.Code, res)
	}
	if h.fake.requestID != "req-abc" {
		t.Fatalf("request id not propagated, got %q", h.fake.requestID)
	}
}

func TestMapsDeclineReasonsToNetworkCodes(t *testing.T) {
	for reason, code := range map[string]string{
		"INSUFFICIENT_CREDIT": CodeInsufficientFunds,
		"CARD_FROZEN":         CodeRestrictedCard,
		"CARD_NOT_FOUND":      CodeInvalidCard,
		"CARD_EXPIRED":        CodeExpiredCard,
		"SOMETHING_NEW":       CodeDoNotHonor,
	} {
		h := newHarness(t, &fakeLending{authorize: declined(reason)}, 5)
		res := decode(t, h.post("/v1/authorizations", authorizeBody("net:decline-"+strings.ToLower(reason[:4]), 100)))
		if res.Approved || res.ResponseCode != code || res.Reason != reason {
			t.Errorf("%s: got %+v, want code %s", reason, res, code)
		}
	}
}

func TestRejectsBadMessagesWithoutCallingTheIssuer(t *testing.T) {
	h := newHarness(t, &fakeLending{authorize: func(_ int, r lending.AuthorizeRequest) (int, any) { return approved(r) }}, 5)
	for name, body := range map[string]string{
		"fractional amount": strings.Replace(authorizeBody("net:bad-0001", 1), `"amount":1`, `"amount":1.5`, 1),
		"zero amount":       authorizeBody("net:bad-0002", 0),
		"over the limit":    authorizeBody("net:bad-0003", 1_000_001),
		"unknown field":     strings.Replace(authorizeBody("net:bad-0004", 1), `{`, `{"pin":"1234",`, 1),
		"bad token":         strings.Replace(authorizeBody("net:bad-0005", 1), cardToken, "tok_nope", 1),
		"not json":          "{",
	} {
		rec := h.post("/v1/authorizations", body)
		if rec.Code != 400 || decode(t, rec).ResponseCode != CodeFormatError {
			t.Errorf("%s: got %d %s", name, rec.Code, rec.Body.String())
		}
	}
	if n := len(h.fake.paths()); n != 0 {
		t.Fatalf("issuer called %d times for invalid messages", n)
	}
}

func TestRequiresNetworkCredentials(t *testing.T) {
	h := newHarness(t, &fakeLending{}, 5)
	rec := h.post("/v1/authorizations", authorizeBody("net:nokey-01", 1), "X-Network-Key", "wrong")
	if rec.Code != 401 {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestTimeoutDeclinesAndReversesTheHiddenApproval(t *testing.T) {
	fake := &fakeLending{authorize: func(call int, r lending.AuthorizeRequest) (int, any) {
		if call == 1 {
			time.Sleep(300 * time.Millisecond) // approves, but after the gateway gave up
		}
		return approved(r)
	}}
	h := newHarness(t, fake, 5)

	start := time.Now()
	res := decode(t, h.post("/v1/authorizations", authorizeBody("net:timeout-1", 5000)))
	if res.Approved || res.ResponseCode != CodeIssuerUnavailable {
		t.Fatalf("expected a fail-closed decline, got %+v", res)
	}
	if elapsed := time.Since(start); elapsed > 250*time.Millisecond {
		t.Fatalf("decline took %s: the authorization deadline was not enforced", elapsed)
	}
	eventually(t, func() bool {
		paths := h.fake.paths()
		return len(paths) > 0 && paths[len(paths)-1] == "/v1/network/authorizations/"+authID+"/reverse"
	})

	// The network retransmits: the answer must stay "declined", without asking the issuer.
	before := len(h.fake.paths())
	again := decode(t, h.post("/v1/authorizations", authorizeBody("net:timeout-1", 5000)))
	if again.Approved || again.ResponseCode != CodeIssuerUnavailable || len(h.fake.paths()) != before {
		t.Fatalf("retransmission after a stand-in decline must be declined locally, got %+v", again)
	}
}

func TestTimeoutWithoutApprovalNeedsNoReversal(t *testing.T) {
	fake := &fakeLending{authorize: func(call int, r lending.AuthorizeRequest) (int, any) {
		if call == 1 {
			return 503, map[string]string{"code": "UNAVAILABLE"}
		}
		return declined("INSUFFICIENT_CREDIT")(call, r)
	}}
	h := newHarness(t, fake, 5)
	h.post("/v1/authorizations", authorizeBody("net:timeout-2", 5000))
	eventually(t, func() bool { return fake.authCalls.Load() == 2 })
	time.Sleep(50 * time.Millisecond)
	if fake.setCalls.Load() != 0 {
		t.Fatal("a declined replay must not be reversed")
	}
}

func TestBreakerOpensAndStopsCallingTheIssuer(t *testing.T) {
	fake := &fakeLending{
		authorize: func(int, lending.AuthorizeRequest) (int, any) { return 500, map[string]string{} },
		settle:    func(int, string) (int, any) { return 500, map[string]string{} },
	}
	h := newHarness(t, fake, 2)
	h.post("/v1/authorizations", authorizeBody("net:breaker-1", 1))
	h.post("/v1/authorizations", authorizeBody("net:breaker-2", 1))

	res := decode(t, h.post("/v1/authorizations", authorizeBody("net:breaker-3", 1)))
	if res.ResponseCode != CodeIssuerUnavailable || res.Reason != "ISSUER_UNAVAILABLE" {
		t.Fatalf("expected 91 while open, got %+v", res)
	}
	rec := h.post("/v1/authorizations/"+authID+"/capture", "")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("settlement must also be refused while open, got %d", rec.Code)
	}
	time.Sleep(50 * time.Millisecond)
	// Background compensation may replay breaker-1/2, but breaker-3 was never sent: nothing to undo.
	h.fake.mu.Lock()
	defer h.fake.mu.Unlock()
	if h.fake.seenNTIDs["net:breaker-3"] {
		t.Fatal("the open breaker let a network request through")
	}
}

func TestRateLimitsPerCard(t *testing.T) {
	h := newHarness(t, &fakeLending{authorize: func(_ int, r lending.AuthorizeRequest) (int, any) { return approved(r) }}, 5)
	codes := []string{}
	for i := 0; i < 7; i++ {
		res := decode(t, h.post("/v1/authorizations", authorizeBody("net:burst-0"+string(rune('a'+i)), 1)))
		codes = append(codes, res.ResponseCode)
	}
	if strings.Join(codes, ",") != "00,00,00,00,00,65,65" {
		t.Fatalf("unexpected codes %v", codes)
	}
}

func TestDuplicateTransactionIDWithDifferentData(t *testing.T) {
	h := newHarness(t, &fakeLending{authorize: func(int, lending.AuthorizeRequest) (int, any) {
		return 422, map[string]string{"code": "IDEMPOTENCY_KEY_REUSED", "detail": "reused"}
	}}, 5)
	res := decode(t, h.post("/v1/authorizations", authorizeBody("net:dupe-0001", 1)))
	if res.ResponseCode != CodeDuplicateTransmission {
		t.Fatalf("expected 94, got %+v", res)
	}
}

func TestSettlementRetriesTransientFailuresAndPassesThroughRefusals(t *testing.T) {
	fake := &fakeLending{settle: func(call int, path string) (int, any) {
		if strings.HasSuffix(path, "/capture") && call < 3 {
			return 503, map[string]string{}
		}
		if strings.HasSuffix(path, "/reverse") {
			return 409, map[string]string{"code": "AUTHORIZATION_NOT_OPEN", "detail": "already captured"}
		}
		return 200, lending.Authorization{ID: authID, Status: "CAPTURED"}
	}}
	h := newHarness(t, fake, 5)

	rec := h.post("/v1/authorizations/"+authID+"/capture", `{"amount":1200}`)
	if rec.Code != 200 || !bytes.Contains(rec.Body.Bytes(), []byte("CAPTURED")) {
		t.Fatalf("capture: %d %s", rec.Code, rec.Body.String())
	}
	if fake.setCalls.Load() != 3 {
		t.Fatalf("expected 2 retries, got %d calls", fake.setCalls.Load())
	}
	rec = h.post("/v1/authorizations/"+authID+"/reversal", "")
	if rec.Code != 409 || !bytes.Contains(rec.Body.Bytes(), []byte("AUTHORIZATION_NOT_OPEN")) {
		t.Fatalf("reversal: %d %s", rec.Code, rec.Body.String())
	}
	if rec := h.post("/v1/authorizations/not-a-uuid/capture", ""); rec.Code != 400 {
		t.Fatalf("expected 400 for a malformed id, got %d", rec.Code)
	}
}
