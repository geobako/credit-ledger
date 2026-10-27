CREATE TYPE "public"."card_status" AS ENUM('INACTIVE', 'ACTIVE', 'FROZEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."credit_account_status" AS ENUM('PENDING_COLLATERAL', 'ACTIVE', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('PENDING', 'CONFIRMED', 'FAILED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'ops');--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_account_id" uuid NOT NULL,
	"status" "card_status" DEFAULT 'INACTIVE' NOT NULL,
	"last4" char(4) NOT NULL,
	"network_token" text NOT NULL,
	"expiry_month" smallint NOT NULL,
	"expiry_year" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "cards_network_token_unique" UNIQUE("network_token")
);
--> statement-breakpoint
CREATE TABLE "collateral_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "deposit_status" DEFAULT 'PENDING' NOT NULL,
	"provider_reference" text NOT NULL,
	"failure_reason" text,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "collateral_deposits_provider_reference_unique" UNIQUE("provider_reference"),
	CONSTRAINT "collateral_deposits_amount_positive" CHECK ("collateral_deposits"."amount" > 0),
	CONSTRAINT "collateral_deposits_confirmed_has_entry" CHECK (("collateral_deposits"."status" = 'CONFIRMED') = ("collateral_deposits"."journal_entry_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "credit_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "credit_account_status" DEFAULT 'PENDING_COLLATERAL' NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"advance_rate_bps" integer NOT NULL,
	"credit_limit" bigint DEFAULT 0 NOT NULL,
	"outstanding_balance" bigint DEFAULT 0 NOT NULL,
	"held_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "credit_accounts_advance_rate" CHECK ("credit_accounts"."advance_rate_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "credit_accounts_amounts_non_negative" CHECK ("credit_accounts"."credit_limit" >= 0 AND "credit_accounts"."outstanding_balance" >= 0 AND "credit_accounts"."held_amount" >= 0),
	CONSTRAINT "credit_accounts_within_limit" CHECK ("credit_accounts"."outstanding_balance" + "credit_accounts"."held_amount" <= "credit_accounts"."credit_limit")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'customer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"outcome" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_credit_account_id_credit_accounts_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collateral_deposits" ADD CONSTRAINT "collateral_deposits_credit_account_id_credit_accounts_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collateral_deposits" ADD CONSTRAINT "collateral_deposits_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_credit_account_id_idx" ON "cards" USING btree ("credit_account_id");--> statement-breakpoint
CREATE INDEX "collateral_deposits_credit_account_id_idx" ON "collateral_deposits" USING btree ("credit_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_accounts_one_open_per_customer" ON "credit_accounts" USING btree ("customer_id") WHERE "credit_accounts"."status" <> 'CLOSED';