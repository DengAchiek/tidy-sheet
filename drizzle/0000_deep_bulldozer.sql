CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`trial_ends` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `checkout_sessions` (
	`reference` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`plan_code` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`billing_mode` text DEFAULT 'live' NOT NULL,
	`checkout_url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `checkout_user_status` ON `checkout_sessions` (`user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `checkout_one_pending_user` ON `checkout_sessions` (`user_id`) WHERE "checkout_sessions"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `payment_receipts` (
	`reference` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`billing_mode` text DEFAULT 'live' NOT NULL,
	`subscription_code` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`paid_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`customer_code` text,
	`subscription_code` text,
	`plan_code` text,
	`status` text DEFAULT 'none' NOT NULL,
	`billing_mode` text DEFAULT 'live' NOT NULL,
	`period_end` integer DEFAULT 0 NOT NULL,
	`last_paid_at` integer DEFAULT 0 NOT NULL,
	`revoked_at` integer DEFAULT 0 NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'KES' NOT NULL,
	`verified_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_code_unique` ON `subscriptions` (`subscription_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_customer_unique` ON `subscriptions` (`customer_code`);--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`row_count` integer NOT NULL,
	`column_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `usage_user_created` ON `usage_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`processed_at` integer NOT NULL
);
