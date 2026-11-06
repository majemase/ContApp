CREATE TABLE `investment_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ledger_id` integer NOT NULL,
	`name` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `investment_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ledger_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`name` text NOT NULL,
	`ticker` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`asset_class` text NOT NULL,
	`region` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `investment_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `investment_assets_account` ON `investment_assets` (`account_id`);--> statement-breakpoint
CREATE TABLE `investment_operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ledger_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`units` integer,
	`source` text NOT NULL,
	`bucket_movement_id` integer,
	`recurring_expense_id` integer,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `investment_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bucket_movement_id`) REFERENCES `bucket_movements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_expense_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `investment_operations_asset` ON `investment_operations` (`asset_id`);--> statement-breakpoint
CREATE INDEX `investment_operations_ledger_date` ON `investment_operations` (`ledger_id`,`date`);--> statement-breakpoint
CREATE TABLE `investment_valuations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ledger_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`date` text NOT NULL,
	`value_cents` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `investment_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investment_valuations_asset_date` ON `investment_valuations` (`asset_id`,`date`);--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `investment_asset_id` integer REFERENCES investment_assets(id);