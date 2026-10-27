// Package signing implements the HMAC request signature shared with the lending API
// (apps/lending-api/src/common/security/request-signature.ts):
//
//	X-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>\n<METHOD>\n<path>\n<raw body>")>
//
// Method and path are part of the signed message, so a signature for one endpoint can
// never be replayed against another.
package signing

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Sign returns the X-Signature header value for a request.
func Sign(secret []byte, method, path string, body []byte, timestamp int64) string {
	return fmt.Sprintf("t=%d,v1=%s", timestamp, hex.EncodeToString(digest(secret, method, path, body, timestamp)))
}

// ErrInvalidSignature is returned by Verify for any malformed, stale or mismatching signature.
var ErrInvalidSignature = errors.New("invalid signature")

// Verify checks a signature header in constant time and within a freshness window.
func Verify(secret []byte, method, path string, body []byte, header string, tolerance time.Duration, now time.Time) error {
	var timestamp int64 = -1
	var signature []byte
	for _, part := range strings.Split(header, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch key {
		case "t":
			if t, err := strconv.ParseInt(value, 10, 64); err == nil {
				timestamp = t
			}
		case "v1":
			if decoded, err := hex.DecodeString(value); err == nil && len(decoded) == sha256.Size {
				signature = decoded
			}
		}
	}
	if timestamp < 0 || signature == nil {
		return ErrInvalidSignature
	}
	if age := now.Sub(time.Unix(timestamp, 0)); age > tolerance || age < -tolerance {
		return ErrInvalidSignature
	}
	if !hmac.Equal(signature, digest(secret, method, path, body, timestamp)) {
		return ErrInvalidSignature
	}
	return nil
}

func digest(secret []byte, method, path string, body []byte, timestamp int64) []byte {
	mac := hmac.New(sha256.New, secret)
	fmt.Fprintf(mac, "%d\n%s\n%s\n", timestamp, strings.ToUpper(method), path)
	mac.Write(body)
	return mac.Sum(nil)
}
