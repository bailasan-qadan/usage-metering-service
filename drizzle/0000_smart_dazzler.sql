CREATE TABLE "account_usage" (
	"account_id" uuid NOT NULL,
	"month" date NOT NULL,
	"units_used" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "account_usage_account_id_month_pk" PRIMARY KEY("account_id","month"),
	CONSTRAINT "account_usage_units_check" CHECK ("account_usage"."units_used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"key_hash" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "consumption_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" varchar(200) NOT NULL,
	"units" integer NOT NULL,
	"month" date NOT NULL,
	"accepted" boolean NOT NULL,
	"rejected_level" varchar(10),
	"rejected_rule" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumption_account_request_unique" UNIQUE("account_id","request_id"),
	CONSTRAINT "consumption_units_check" CHECK ("consumption_requests"."units" > 0),
	CONSTRAINT "consumption_decision_check" CHECK (("consumption_requests"."accepted" AND "consumption_requests"."rejected_level" IS NULL AND "consumption_requests"."rejected_rule" IS NULL)
        OR (NOT "consumption_requests"."accepted"
          AND "consumption_requests"."rejected_level" IN ('account', 'user')
          AND "consumption_requests"."rejected_rule" IN ('monthly_allowance', 'max_per_request')))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(10) NOT NULL,
	"name" varchar(100) NOT NULL,
	"monthly_allowance" bigint NOT NULL,
	"max_per_request" integer NOT NULL,
	"owner_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_kind_check" CHECK ("plans"."kind" IN ('account', 'user')),
	CONSTRAINT "plans_monthly_allowance_check" CHECK ("plans"."monthly_allowance" >= 0),
	CONSTRAINT "plans_max_per_request_check" CHECK ("plans"."max_per_request" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_usage" (
	"user_id" uuid NOT NULL,
	"month" date NOT NULL,
	"units_used" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "user_usage_user_id_month_pk" PRIMARY KEY("user_id","month"),
	CONSTRAINT "user_usage_units_check" CHECK ("user_usage"."units_used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_account_external_unique" UNIQUE("account_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "account_usage" ADD CONSTRAINT "account_usage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_requests" ADD CONSTRAINT "consumption_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_requests" ADD CONSTRAINT "consumption_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_usage" ADD CONSTRAINT "user_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;