// Package lending is the gateway's client for the lending API's internal network endpoints.
// Every request is HMAC-signed; the lending API remains the only owner of balances.
package lending

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/acme-credit/card-gateway/internal/signing"
)

const serviceID = "card-gateway"

// AuthorizeRequest mirrors the lending API's AuthorizeDto. Field order is fixed by the struct,
// so re-sending the same value produces byte-identical JSON (the API checks a request hash).
type AuthorizeRequest struct {
	NetworkTransactionID string `json:"networkTransactionId"`
	CardToken            string `json:"cardToken"`
	Amount               string `json:"amount"`
	Currency             string `json:"currency"`
	MerchantName         string `json:"merchantName"`
	MerchantCategoryCode string `json:"merchantCategoryCode,omitempty"`
}

type Money struct {
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
}

type Decision struct {
	NetworkTransactionID string  `json:"networkTransactionId"`
	AuthorizationID      *string `json:"authorizationId"`
	Approved             bool    `json:"approved"`
	Status               string  `json:"status"`
	DeclineReason        *string `json:"declineReason"`
	Amount               Money   `json:"amount"`
}

type Authorization struct {
	ID             string `json:"id"`
	Status         string `json:"status"`
	Amount         Money  `json:"amount"`
	CapturedAmount *Money `json:"capturedAmount"`
}

// UnavailableError means the lending API could not give an answer: timeout, connection
// failure or 5xx. The outcome of the request is unknown.
type UnavailableError struct{ Err error }

func (e *UnavailableError) Error() string { return "lending API unavailable: " + e.Err.Error() }
func (e *UnavailableError) Unwrap() error { return e.Err }

// APIError is a definitive refusal (4xx) with the lending API's stable error code.
type APIError struct {
	Status int
	Code   string `json:"code"`
	Detail string `json:"detail"`
}

func (e *APIError) Error() string {
	return fmt.Sprintf("lending API %d %s: %s", e.Status, e.Code, e.Detail)
}

// IsUnavailable reports whether err leaves the outcome unknown (and so may be retried or compensated).
func IsUnavailable(err error) bool {
	var unavailable *UnavailableError
	return errors.As(err, &unavailable)
}

type requestIDKey struct{}

// WithRequestID propagates a correlation id to the lending API.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, id)
}

func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

type Client struct {
	baseURL string
	secret  []byte
	http    *http.Client
	now     func() time.Time
}

func NewClient(baseURL string, secret []byte, httpClient *http.Client) *Client {
	return &Client{baseURL: baseURL, secret: secret, http: httpClient, now: time.Now}
}

func (c *Client) Authorize(ctx context.Context, req AuthorizeRequest) (Decision, error) {
	var decision Decision
	err := c.do(ctx, "/v1/network/authorizations", req, &decision)
	return decision, err
}

// Capture settles an authorization; amount nil captures the full authorized amount.
func (c *Client) Capture(ctx context.Context, authorizationID string, amount *int64) (Authorization, error) {
	var body any
	if amount != nil {
		body = map[string]string{"amount": strconv.FormatInt(*amount, 10)}
	}
	var auth Authorization
	err := c.do(ctx, "/v1/network/authorizations/"+authorizationID+"/capture", body, &auth)
	return auth, err
}

func (c *Client) Reverse(ctx context.Context, authorizationID string) (Authorization, error) {
	var auth Authorization
	err := c.do(ctx, "/v1/network/authorizations/"+authorizationID+"/reverse", nil, &auth)
	return auth, err
}

func (c *Client) do(ctx context.Context, path string, body any, out any) error {
	var raw []byte
	if body != nil {
		var err error
		if raw, err = json.Marshal(body); err != nil {
			return fmt.Errorf("encode request: %w", err)
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("X-Service-Id", serviceID)
	req.Header.Set("X-Signature", signing.Sign(c.secret, http.MethodPost, path, raw, c.now().Unix()))
	if id := RequestID(ctx); id != "" {
		req.Header.Set("X-Request-Id", id)
	}

	res, err := c.http.Do(req)
	if err != nil {
		return &UnavailableError{Err: err}
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return &UnavailableError{Err: err}
	}
	switch {
	case res.StatusCode >= 500:
		return &UnavailableError{Err: fmt.Errorf("status %d", res.StatusCode)}
	case res.StatusCode >= 400:
		apiErr := &APIError{Status: res.StatusCode}
		_ = json.Unmarshal(payload, apiErr)
		return apiErr
	}
	if err := json.Unmarshal(payload, out); err != nil {
		return &UnavailableError{Err: fmt.Errorf("decode response: %w", err)}
	}
	return nil
}
