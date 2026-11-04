CREATE TABLE `bucket_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ledger_id` integer NOT NULL,
	`bucket_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`date` text NOT NULL,
	`month` text,
	`kind` text NOT NULL,
	`affects_budget` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`group_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `movements_bucket` ON `bucket_movements` (`bucket_id`);--> statement-breakpoint
CREATE INDEX `movements_ledger_month` ON `bucket_movements` (`ledger_id`,`month`);--> statement-breakpoint
CREATE TABLE `buckets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ledger_id` integer NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`target_cents` integer,
	`recurring_expense_id` integer,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_expense_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buckets_recurring_expense_id_unique` ON `buckets` (`recurring_expense_id`);--> statement-breakpoint
CREATE TABLE `month_closes` (
	`ledger_id` integer NOT NULL,
	`month` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`income_cents` integer NOT NULL,
	`needs_cents` integer NOT NULL,
	`wants_cents` integer NOT NULL,
	`savings_cents` integer NOT NULL,
	PRIMARY KEY(`ledger_id`, `month`),
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `ledger_settings` ADD `savings_bucket_id` integer REFERENCES buckets(id);--> statement-breakpoint
ALTER TABLE `ledger_settings` ADD `extra_rules` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger_settings` ADD `target_needs_pct` integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger_settings` ADD `target_wants_pct` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger_settings` ADD `target_savings_pct` integer DEFAULT 20 NOT NULL;