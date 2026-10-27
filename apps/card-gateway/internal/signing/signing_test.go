package signing

import (
	"testing"
	"time"
)

var secret = []byte("cross-language-test-secret-0123456789abcdef")

// Vectors produced by the TypeScript implementation (signRequest in the lending API).
// If either side changes its message format, this test fails.
func TestSignMatchesTypeScriptImplementation(t *testing.T) {
	cases := []struct {
		method, path, body, want string
	}{
		{"POST", "/v1/network/authorizations", `{"amount":"1250","currency":"USD"}`,
			"t=1800000000,v1=78b73fe7007cd49ec039d8371156990143d4834244259df111bb8903b2d8596d"},
		{"POST", "/v1/network/authorizations/7d0f1c8e-0000-4000-8000-000000000001/reverse", "",
			"t=1800000000,v1=b4fdd3cc4ee28fa69a3842cd071921d25b2bee6ec68e3c4f3d69d65715045129"},
	}
	for _, c := range cases {
		if got := Sign(secret, c.method, c.path, []byte(c.body), 1_800_000_000); got != c.want {
			t.Errorf("Sign(%s %s) = %s, want %s", c.method, c.path, got, c.want)
		}
	}
}

func TestVerify(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	body := []byte(`{"x":1}`)
	valid := Sign(secret, "POST", "/a", body, now.Unix())

	if err := Verify(secret, "POST", "/a", body, valid, 5*time.Minute, now); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}
	rejected := map[string]struct {
		method, path string
		body         []byte
		header       string
		now          time.Time
	}{
		"other path":   {"POST", "/b", body, valid, now},
		"other method": {"GET", "/a", body, valid, now},
		"other body":   {"POST", "/a", []byte(`{"x":2}`), valid, now},
		"stale":        {"POST", "/a", body, valid, now.Add(6 * time.Minute)},
		"garbage":      {"POST", "/a", body, "t=x,v1=zz", now},
		"empty":        {"POST", "/a", body, "", now},
	}
	for name, c := range rejected {
		if err := Verify(secret, c.method, c.path, c.body, c.header, 5*time.Minute, c.now); err == nil {
			t.Errorf("%s: expected rejection", name)
		}
	}
}
