ALTER TABLE `admin_invitations` ADD `purpose` text DEFAULT 'register' NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_invitations` ADD `claim_hash` text;