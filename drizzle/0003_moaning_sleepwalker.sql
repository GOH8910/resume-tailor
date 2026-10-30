CREATE TABLE "ad_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"ip" text NOT NULL,
	"provider" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_at" timestamp with time zone,
	"status" text DEFAULT 'started' NOT NULL,
	"reject_reason" text,
	"transaction_id" text,
	CONSTRAINT "ad_sessions_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "ad_sessions_status_check" CHECK ("ad_sessions"."status" in ('started', 'granted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "credit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_events_kind_check" CHECK ("credit_events"."kind" in ('ad', 'signup', 'tailor', 'chat', 'admin', 'refund'))
);
--> statement-breakpoint
ALTER TABLE "ad_sessions" ADD CONSTRAINT "ad_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_events" ADD CONSTRAINT "credit_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_sessions_user_id_started_at_idx" ON "ad_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "ad_sessions_ip_started_at_idx" ON "ad_sessions" USING btree ("ip","started_at");--> statement-breakpoint
CREATE INDEX "credit_events_user_id_created_at_idx" ON "credit_events" USING btree ("user_id","created_at");