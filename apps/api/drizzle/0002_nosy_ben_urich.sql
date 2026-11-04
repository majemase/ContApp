ALTER TABLE `ledger_settings` ADD `savings_mode` text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger_settings` ADD `savings_pct` integer DEFAULT 0 NOT NULL;