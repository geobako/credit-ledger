CREATE TYPE "public"."closure_reason" AS ENUM('CUSTOMER_REQUEST', 'CHARGE_OFF');--> statement-breakpoint
CREATE TYPE "public"."repayment_status" AS ENUM('PENDING', 'SETTLED', 'FAILED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "account_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_account_id" uuid NOT NULL,
	"reason" "closure_reason" NOT NULL,
	"initiated_by" uuid NOT NULL,
	"debt_at_closure" bigint NOT NULL,
	"refund_applied" bigint NOT NULL,
	"collateral_applied" bigint NOT NULL,
	"written_off" bigint NOT NULL,
	"payout_amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_closures_credit_account_id_unique" UNIQUE("credit_account_id"),
	CONSTRAINT "account_closures_debt_settled" CHECK ("account_closures"."refund_applied" + "account_closures"."collateral_applied" + "account_closures"."written_off" = "account_closures"."debt_at_closure"),
	CONSTRAINT "account_closures_non_negative" CHECK ("account_closures"."debt_at_closure" >= 0 AND "account_closures"."refund_applied" >= 0 AND "account_closures"."collateral_applied" >= 0 AND "account_closures"."written_off" >= 0 AND "account_closures"."payout_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "repayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "repayment_status" DEFAULT 'PENDING' NOT NULL,
	"provider_reference" text NOT NULL,
	"applied_amount" bigint,
	"excess_amount" bigint,
	"failure_reason" text,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "repayments_provider_reference_unique" UNIQUE("provider_reference"),
	CONSTRAINT "repayments_amount_positive" CHECK ("repayments"."amount" > 0),
	CONSTRAINT "repayments_settled_consistent" CHECK (("repayments"."status" = 'SETTLED') = ("repayments"."journal_entry_id" IS NOT NULL AND "repayments"."applied_amount" IS NOT NULL AND "repayments"."excess_amount" IS NOT NULL)),
	CONSTRAINT "repayments_split_adds_up" CHECK ("repayments"."applied_amount" IS NULL OR "repayments"."applied_amount" + "repayments"."excess_amount" = "repayments"."amount")
);
--> statement-breakpoint
ALTER TABLE "account_closures" ADD CONSTRAINT "account_closures_credit_account_id_credit_accounts_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_closures" ADD CONSTRAINT "account_closures_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_credit_account_id_credit_accounts_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repayments_credit_account_id_idx" ON "repayments" USING btree ("credit_account_id");