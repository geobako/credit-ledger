CREATE TYPE "public"."authorization_status" AS ENUM('HELD', 'CAPTURED', 'REVERSED', 'EXPIRED', 'DECLINED');--> statement-breakpoint
CREATE TABLE "authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_account_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"network_transaction_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "authorization_status" NOT NULL,
	"decline_reason" text,
	"merchant_name" text NOT NULL,
	"merchant_category_code" char(4),
	"captured_amount" bigint,
	"journal_entry_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "authorizations_network_transaction_id_unique" UNIQUE("network_transaction_id"),
	CONSTRAINT "authorizations_amount_positive" CHECK ("authorizations"."amount" > 0),
	CONSTRAINT "authorizations_capture_within_hold" CHECK ("authorizations"."captured_amount" IS NULL OR ("authorizations"."captured_amount" > 0 AND "authorizations"."captured_amount" <= "authorizations"."amount")),
	CONSTRAINT "authorizations_captured_consistent" CHECK (("authorizations"."status" = 'CAPTURED') = ("authorizations"."captured_amount" IS NOT NULL AND "authorizations"."journal_entry_id" IS NOT NULL)),
	CONSTRAINT "authorizations_declined_has_reason" CHECK (("authorizations"."status" = 'DECLINED') = ("authorizations"."decline_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_credit_account_id_credit_accounts_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "authorizations_credit_account_id_idx" ON "authorizations" USING btree ("credit_account_id","created_at");--> statement-breakpoint
CREATE INDEX "authorizations_held_expiry_idx" ON "authorizations" USING btree ("expires_at") WHERE "authorizations"."status" = 'HELD';