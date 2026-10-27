CREATE TYPE "public"."account_category" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."entry_direction" AS ENUM('DEBIT', 'CREDIT');--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" char(64) NOT NULL,
	"response_status" smallint,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key"),
	CONSTRAINT "idempotency_keys_key_length" CHECK (length("idempotency_keys"."key") BETWEEN 8 AND 255)
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_type" text NOT NULL,
	"reference" text,
	"description" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"owner_id" uuid,
	"category" "account_category" NOT NULL,
	"currency" char(3) NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_kind_owner_currency_key" UNIQUE NULLS NOT DISTINCT("kind","owner_id","currency"),
	CONSTRAINT "ledger_accounts_balance_non_negative" CHECK ("ledger_accounts"."allow_negative" OR "ledger_accounts"."balance" >= 0),
	CONSTRAINT "ledger_accounts_currency_format" CHECK ("ledger_accounts"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "postings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "postings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"journal_entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"direction" "entry_direction" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "postings_amount_positive" CHECK ("postings"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "journal_entries_created_at_idx" ON "journal_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "postings_journal_entry_id_idx" ON "postings" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "postings_account_id_idx" ON "postings" USING btree ("account_id","id");