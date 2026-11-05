CREATE TABLE `ledger_members` (
	`user_id` integer NOT NULL,
	`ledger_id` integer NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`user_id`, `ledger_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ledger_members_ledger` ON `ledger_members` (`ledger_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sub` text NOT NULL,
	`email` text,
	`name` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_sub_unique` ON `users` (`sub`);