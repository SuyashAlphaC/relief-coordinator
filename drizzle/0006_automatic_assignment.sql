ALTER TABLE `incidents` ADD `assignment_state` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `incidents` ADD `assigned_at` text;--> statement-breakpoint
ALTER TABLE `incidents` ADD `assignment_distance_km` real;--> statement-breakpoint
ALTER TABLE `incidents` ADD `assignment_checked_at` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `lat` real;--> statement-breakpoint
ALTER TABLE `teams` ADD `lng` real;--> statement-breakpoint
ALTER TABLE `teams` ADD `available` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `version` integer DEFAULT 1 NOT NULL;