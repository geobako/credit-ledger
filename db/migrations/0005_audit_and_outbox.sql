CREATE TABLE "audit_log" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"credit_account_id" uuid,
	"request_id" text,
	"data" jsonb NOT NULL,
	"chain_position" bigint,
	"prev_hash" char(64),
	"hash" char(64),
	CONSTRAINT "audit_log_chain_position_unique" UNIQUE("chain_position"),
	CONSTRAINT "audit_log_hash_unique" UNIQUE("hash"),
	CONSTRAINT "audit_log_seal_complete" CHECK (("audit_log"."hash" IS NULL) = ("audit_log"."chain_position" IS NULL) AND ("audit_log"."hash" IS NULL) = ("audit_log"."prev_hash" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "outbox_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "audit_log_credit_account_idx" ON "audit_log" USING btree ("credit_account_id","seq");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_unsealed_idx" ON "audit_log" USING btree ("seq") WHERE "audit_log"."hash" IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("available_at","seq") WHERE "outbox_events"."published_at" IS NULL;