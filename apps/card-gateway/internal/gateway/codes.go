package gateway

// ISO 8583-style response codes returned to the card network.
const (
	CodeApproved              = "00"
	CodeDoNotHonor            = "05"
	CodeInvalidCard           = "14"
	CodeFormatError           = "30"
	CodeClosedAccount         = "46"
	CodeInsufficientFunds     = "51"
	CodeExpiredCard           = "54"
	CodeNotPermitted          = "57"
	CodeRestrictedCard        = "62"
	CodeFrequencyExceeded     = "65"
	CodeBlockedFirstUse       = "78"
	CodeIssuerUnavailable     = "91"
	CodeDuplicateTransmission = "94"
)

// declineCodes maps the lending API's decline reasons to network response codes.
var declineCodes = map[string]string{
	"CARD_NOT_FOUND":         CodeInvalidCard,
	"CARD_INACTIVE":          CodeBlockedFirstUse,
	"CARD_FROZEN":            CodeRestrictedCard,
	"CARD_CLOSED":            CodeClosedAccount,
	"CARD_EXPIRED":           CodeExpiredCard,
	"ACCOUNT_NOT_ACTIVE":     CodeDoNotHonor,
	"CURRENCY_NOT_SUPPORTED": CodeNotPermitted,
	"INSUFFICIENT_CREDIT":    CodeInsufficientFunds,
}

func declineCode(reason string) string {
	if code, ok := declineCodes[reason]; ok {
		return code
	}
	return CodeDoNotHonor
}
