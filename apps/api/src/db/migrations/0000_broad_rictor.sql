CREATE TYPE "public"."book_condition" AS ENUM('NEW', 'LIKE_NEW', 'VERY_GOOD', 'GOOD', 'FAIR', 'POOR');--> statement-breakpoint
CREATE TYPE "public"."copy_status" AS ENUM('IN_STOCK', 'AT_STALL', 'SOLD', 'WRITTEN_OFF');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('VALID', 'WARNING', 'ERROR', 'COMMITTED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('UPLOADED', 'VALIDATING', 'READY', 'COMMITTING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."metadata_source" AS ENUM('OPEN_LIBRARY', 'GOOGLE_BOOKS', 'MANUAL', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."movement_outcome" AS ENUM('OPEN', 'RETURNED', 'SOLD', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'UPI', 'CARD', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('COMPLETED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."stall_status" AS ENUM('PLANNED', 'ACTIVE', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'INVENTORY_STAFF', 'STALL_MANAGER');--> statement-breakpoint
CREATE TYPE "public"."writeoff_reason" AS ENUM('DAMAGED', 'LOST', 'DONATED_ONWARD', 'RECYCLED', 'OTHER');--> statement-breakpoint
CREATE SEQUENCE "public"."copy_code_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."receipt_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_username_format" CHECK ("users"."username" = lower("users"."username") AND "users"."username" ~ '^[a-z0-9._-]{3,32}$')
);
--> statement-breakpoint
CREATE TABLE "genre_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"genre_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "genre_keywords_genre_id_keyword_key" UNIQUE("genre_id","keyword"),
	CONSTRAINT "genre_keywords_lower" CHECK ("genre_keywords"."keyword" = lower("genre_keywords"."keyword"))
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"color" text DEFAULT '#888888' NOT NULL,
	"sort_order" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "genres_name_unique" UNIQUE("name"),
	CONSTRAINT "genres_code_unique" UNIQUE("code"),
	CONSTRAINT "genres_code_format" CHECK ("genres"."code" ~ '^[A-Z]{2,4}$'),
	CONSTRAINT "genres_color_format" CHECK ("genres"."color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "racks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"sort_order" integer NOT NULL,
	CONSTRAINT "racks_code_unique" UNIQUE("code"),
	CONSTRAINT "racks_code_format" CHECK ("racks"."code" ~ '^[A-Z]{1,2}$')
);
--> statement-breakpoint
CREATE TABLE "shelf_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rack_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"code" text NOT NULL,
	"capacity" integer NOT NULL,
	"genre_id" uuid,
	"is_overflow" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "shelf_rows_code_unique" UNIQUE("code"),
	CONSTRAINT "shelf_rows_rack_id_row_number_key" UNIQUE("rack_id","row_number"),
	CONSTRAINT "shelf_rows_row_number_range" CHECK ("shelf_rows"."row_number" BETWEEN 1 AND 99),
	CONSTRAINT "shelf_rows_capacity_range" CHECK ("shelf_rows"."capacity" BETWEEN 1 AND 999)
);
--> statement-breakpoint
CREATE TABLE "book_titles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"isbn13" text,
	"isbn10" text,
	"title" text NOT NULL,
	"subtitle" text,
	"authors" text[] DEFAULT '{}'::text[] NOT NULL,
	"author_sort" text DEFAULT '' NOT NULL,
	"title_sort" text NOT NULL,
	"publisher" text,
	"published_year" integer,
	"language" text,
	"page_count" integer,
	"edition" text,
	"summary" text,
	"subjects" text[] DEFAULT '{}'::text[] NOT NULL,
	"genre_id" uuid NOT NULL,
	"cover_key" text,
	"cover_source_url" text,
	"source" "metadata_source" NOT NULL,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_titles_isbn13_unique" UNIQUE("isbn13"),
	CONSTRAINT "book_titles_isbn13_format" CHECK ("book_titles"."isbn13" ~ '^97[89][0-9]{10}$'),
	CONSTRAINT "book_titles_isbn10_format" CHECK ("book_titles"."isbn10" ~ '^[0-9]{9}[0-9X]$'),
	CONSTRAINT "book_titles_title_len" CHECK (length("book_titles"."title") BETWEEN 1 AND 500),
	CONSTRAINT "book_titles_year_range" CHECK ("book_titles"."published_year" BETWEEN 1400 AND 2100),
	CONSTRAINT "book_titles_pages_positive" CHECK ("book_titles"."page_count" > 0),
	CONSTRAINT "book_titles_summary_len" CHECK (length("book_titles"."summary") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "stall_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stall_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unassigned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"description" text,
	"starts_on" date,
	"ends_on" date,
	"status" "stall_status" DEFAULT 'PLANNED' NOT NULL,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stalls_dates_order" CHECK ("stalls"."ends_on" IS NULL OR "stalls"."starts_on" IS NULL OR "stalls"."ends_on" >= "stalls"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "copies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title_id" uuid NOT NULL,
	"condition" "book_condition" NOT NULL,
	"condition_notes" text,
	"original_price_minor" integer,
	"selling_price_minor" integer NOT NULL,
	"status" "copy_status" DEFAULT 'IN_STOCK' NOT NULL,
	"row_id" uuid,
	"slot_number" integer,
	"last_location_code" text,
	"current_stall_id" uuid,
	"writeoff_reason" "writeoff_reason",
	"donor_name" text,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"label_printed_at" timestamp with time zone,
	"label_needs_print" boolean DEFAULT true NOT NULL,
	"notes" text,
	"sold_at" timestamp with time zone,
	"created_by_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copies_code_unique" UNIQUE("code"),
	CONSTRAINT "copies_unique_slot" UNIQUE("row_id","slot_number"),
	CONSTRAINT "copies_code_format" CHECK ("copies"."code" ~ '^[A-Z]{2,4}[0-9]{7}$'),
	CONSTRAINT "copies_original_price_nonneg" CHECK ("copies"."original_price_minor" >= 0),
	CONSTRAINT "copies_selling_price_nonneg" CHECK ("copies"."selling_price_minor" >= 0),
	CONSTRAINT "copies_slot_positive" CHECK ("copies"."slot_number" >= 1),
	CONSTRAINT "copies_slot_pair" CHECK (("copies"."row_id" IS NULL) = ("copies"."slot_number" IS NULL)),
	CONSTRAINT "copies_stall_status" CHECK (("copies"."status" = 'AT_STALL') = ("copies"."current_stall_id" IS NOT NULL)),
	CONSTRAINT "copies_slot_released" CHECK ("copies"."status" IN ('IN_STOCK','AT_STALL') OR "copies"."row_id" IS NULL),
	CONSTRAINT "copies_sold_at" CHECK (("copies"."status" = 'SOLD') = ("copies"."sold_at" IS NOT NULL)),
	CONSTRAINT "copies_writeoff" CHECK (("copies"."status" = 'WRITTEN_OFF') = ("copies"."writeoff_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "stall_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"copy_id" uuid NOT NULL,
	"stall_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"checked_out_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_out_by_id" uuid NOT NULL,
	"checked_in_at" timestamp with time zone,
	"checked_in_by_id" uuid,
	"outcome" "movement_outcome" DEFAULT 'OPEN' NOT NULL,
	CONSTRAINT "stall_movements_returned_checkin" CHECK (("stall_movements"."outcome" = 'RETURNED') = ("stall_movements"."checked_in_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"copy_id" uuid NOT NULL,
	"list_price_minor" integer NOT NULL,
	"sold_price_minor" integer NOT NULL,
	CONSTRAINT "sale_items_sale_id_copy_id_key" UNIQUE("sale_id","copy_id"),
	CONSTRAINT "sale_items_list_nonneg" CHECK ("sale_items"."list_price_minor" >= 0),
	CONSTRAINT "sale_items_sold_nonneg" CHECK ("sale_items"."sold_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_no" text NOT NULL,
	"stall_id" uuid,
	"sold_by_id" uuid NOT NULL,
	"sold_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"total_minor" integer NOT NULL,
	"status" "sale_status" DEFAULT 'COMPLETED' NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"notes" text,
	"client_ref" uuid,
	"voided_at" timestamp with time zone,
	"voided_by_id" uuid,
	"void_reason" text,
	CONSTRAINT "sales_receiptNo_unique" UNIQUE("receipt_no"),
	CONSTRAINT "sales_clientRef_unique" UNIQUE("client_ref"),
	CONSTRAINT "sales_total_nonneg" CHECK ("sales"."total_minor" >= 0),
	CONSTRAINT "sales_voided_at" CHECK (("sales"."status" = 'VOIDED') = ("sales"."voided_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_key" text NOT NULL,
	"original_name" text NOT NULL,
	"status" "import_status" DEFAULT 'UPLOADED' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"warning_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"copies_created" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "import_row_status" NOT NULL,
	"created_copy_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	CONSTRAINT "import_rows_job_id_row_number_key" UNIQUE("job_id","row_number")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_lookup_cache" (
	"provider" text NOT NULL,
	"lookup_key" text NOT NULL,
	"payload" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_lookup_cache_provider_lookup_key_pk" PRIMARY KEY("provider","lookup_key")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genre_keywords" ADD CONSTRAINT "genre_keywords_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_rows" ADD CONSTRAINT "shelf_rows_rack_id_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."racks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_rows" ADD CONSTRAINT "shelf_rows_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_titles" ADD CONSTRAINT "book_titles_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stall_assignments" ADD CONSTRAINT "stall_assignments_stall_id_stalls_id_fk" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stall_assignments" ADD CONSTRAINT "stall_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_title_id_book_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."book_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_row_id_shelf_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."shelf_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_current_stall_id_stalls_id_fk" FOREIGN KEY ("current_stall_id") REFERENCES "public"."stalls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stall_movements" ADD CONSTRAINT "stall_movements_copy_id_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."copies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stall_movements" ADD CONSTRAINT "stall_movements_stall_id_stalls_id_fk" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stall_movements" ADD CONSTRAINT "stall_movements_checked_out_by_id_users_id_fk" FOREIGN KEY ("checked_out_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stall_movements" ADD CONSTRAINT "stall_movements_checked_in_by_id_users_id_fk" FOREIGN KEY ("checked_in_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_copy_id_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."copies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_stall_id_stalls_id_fk" FOREIGN KEY ("stall_id") REFERENCES "public"."stalls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_sold_by_id_users_id_fk" FOREIGN KEY ("sold_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "genre_keywords_keyword_idx" ON "genre_keywords" USING btree ("keyword");--> statement-breakpoint
CREATE INDEX "shelf_rows_genre_idx" ON "shelf_rows" USING btree ("genre_id");--> statement-breakpoint
CREATE INDEX "book_titles_genre_idx" ON "book_titles" USING btree ("genre_id");--> statement-breakpoint
CREATE INDEX "book_titles_title_sort_idx" ON "book_titles" USING btree ("title_sort");--> statement-breakpoint
CREATE INDEX "book_titles_author_sort_idx" ON "book_titles" USING btree ("author_sort");--> statement-breakpoint
CREATE INDEX "book_titles_search_trgm" ON "book_titles" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "stall_assignments_one_active_per_user" ON "stall_assignments" USING btree ("user_id") WHERE "stall_assignments"."unassigned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "stall_assignments_stall_idx" ON "stall_assignments" USING btree ("stall_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stalls_name_live_uq" ON "stalls" USING btree (lower("name")) WHERE "stalls"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "copies_title_status_idx" ON "copies" USING btree ("title_id","status");--> statement-breakpoint
CREATE INDEX "copies_stall_status_idx" ON "copies" USING btree ("current_stall_id","status");--> statement-breakpoint
CREATE INDEX "copies_status_price_idx" ON "copies" USING btree ("status","selling_price_minor");--> statement-breakpoint
CREATE INDEX "copies_label_queue_idx" ON "copies" USING btree ("label_needs_print") WHERE "copies"."label_needs_print";--> statement-breakpoint
CREATE INDEX "copies_unshelved_idx" ON "copies" USING btree ("status") WHERE "copies"."row_id" IS NULL AND "copies"."status" = 'IN_STOCK';--> statement-breakpoint
CREATE UNIQUE INDEX "stall_movements_one_open_per_copy" ON "stall_movements" USING btree ("copy_id") WHERE "stall_movements"."outcome" = 'OPEN';--> statement-breakpoint
CREATE INDEX "stall_movements_stall_idx" ON "stall_movements" USING btree ("stall_id","outcome");--> statement-breakpoint
CREATE INDEX "stall_movements_batch_idx" ON "stall_movements" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "sale_items_copy_idx" ON "sale_items" USING btree ("copy_id");--> statement-breakpoint
CREATE INDEX "sales_stall_time_idx" ON "sales" USING btree ("stall_id","sold_at" desc);--> statement-breakpoint
CREATE INDEX "sales_seller_time_idx" ON "sales" USING btree ("sold_by_id","sold_at" desc);--> statement-breakpoint
CREATE INDEX "sales_status_time_idx" ON "sales" USING btree ("status","sold_at" desc);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_time_idx" ON "audit_logs" USING btree ("created_at" desc);