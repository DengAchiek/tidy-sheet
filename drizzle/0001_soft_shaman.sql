ALTER TABLE `subscriptions` ADD `tier` text DEFAULT 'premium' NOT NULL;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `mode` text DEFAULT 'business' NOT NULL;