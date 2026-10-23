CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`body_hash` text NOT NULL,
	`result_id` text NOT NULL,
	`created_at` text NOT NULL
);
