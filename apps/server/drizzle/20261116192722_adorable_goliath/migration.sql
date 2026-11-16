CREATE TABLE `appointments` (
	`id` text PRIMARY KEY,
	`patient_id` text NOT NULL,
	`doctor_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	CONSTRAINT `fk_appointments_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_appointments_doctor_id_doctors_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `doctors` (
	`id` text PRIMARY KEY,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL
);
