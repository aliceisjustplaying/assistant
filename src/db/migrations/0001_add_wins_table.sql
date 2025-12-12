CREATE TABLE `wins` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`content` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`magnitude` text DEFAULT 'tiny' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
