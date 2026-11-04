CREATE TABLE `incomes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ledger_id` integer NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`type` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `incomes_ledger_date` ON `incomes` (`ledger_id`,`date`);--> statement-breakpoint
CREATE TABLE `ledger_settings` (
	`ledger_id` integer PRIMARY KEY NOT NULL,
	`reference_income_cents` integer,
	`min_savings_cents` integer DEFAULT 0 NOT NULL,
	`health_threshold_pct` integer DEFAULT 70 NOT NULL,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action
);
