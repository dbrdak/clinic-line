import { llm } from '@livekit/agents';
import { z } from 'zod';
import {
	appointmentQuerySchema,
	createAppointmentSchema,
	createPatientSchema,
	type Patient,
} from '@clinicline/contracts';
import { ClinicClient } from './clinic.client.ts';

const dateRange = appointmentQuerySchema.pick({ starts_from: true, starts_to: true }).required();
const appointmentId = z.uuid().describe('Appointment ID returned by getPatientAppointments.');

export default class ClinicTools {
	private currentPatient: Patient | undefined;
	private readonly client: ClinicClient;

	constructor(client = new ClinicClient()) {
		this.client = client;
	}

	register = () => [
		...this.createClinicTools(),
		...this.createPatientTools(),
		...this.createDoctorTools(),
		...this.createAppointmentTools(),
	];

	private createClinicTools() {
		return [
			llm.tool({
				name: 'getClinicInfo',
				description: `
        Get clinic timezone, business hours, visit duration and booking policy.
        Use before scheduling or interpreting relative dates. Returns policy and the current UTC time.
        `,
				parameters: z.object({}),
				execute: async (_, { abortSignal }) => await this.client.getClinicPolicy(abortSignal),
			}),
		];
	}

	private createPatientTools() {
		return [
			llm.tool({
				name: 'addPatient',
				description: `
        Register a new patient using their first and last name, after they agree to registration.
        Returns the saved patient and selects them for this call. Look up an existing patient first;
        do not retry an uncertain registration.
        `,
				parameters: createPatientSchema,
				execute: async (patient, { ctx }) => {
					ctx.disallowInterruptions();
					this.currentPatient = undefined;
					this.currentPatient = await this.client.addPatient(patient);
					return this.currentPatient;
				},
			}),
			llm.tool({
				name: 'getPatient',
				description: `
        Find and select the caller by their first and last name. Returns only the unique matching patient.
        With no names, refreshes the current patient. Names select a record, not verified identity.
        Never use to browse other patients.
        `,
				parameters: createPatientSchema.partial(),
				execute: async ({ first_name, last_name }, { abortSignal }) => {
					if (!first_name || !last_name) {
						throw new llm.ToolError('Ask for both first and last name.');
					}

					this.currentPatient = undefined;

					const patients = await this.client.getPatients(abortSignal);
					const normalize = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('pl');

					const matches = patients.filter(
						(p) =>
							normalize(p.first_name) === normalize(first_name) &&
							normalize(p.last_name) === normalize(last_name),
					);

					if (matches.length !== 1) {
						throw new llm.ToolError(
							matches.length
								? 'Multiple patients share that name. Do not choose one or disclose their records; ask the caller to contact the clinic.'
								: 'Patient not found. Ask whether the caller wants to register.',
						);
					}

					this.currentPatient = matches[0];

					const id = this.patientId();

					this.currentPatient = undefined;
					this.currentPatient = await this.client.getPatient(id, abortSignal);

					return this.currentPatient;
				},
			}),
		];
	}

	private createDoctorTools() {
		return [
			llm.tool({
				name: 'getDoctors',
				description: `
        List clinic doctors and their IDs when choosing a doctor.
        Being listed does not mean a doctor has a free appointment; query their schedule separately.
        `,
				parameters: z.object({}),
				execute: async (_, { abortSignal }) => await this.client.getDoctors(abortSignal),
			}),
		];
	}

	private createAppointmentTools() {
		return [
			llm.tool({
				name: 'getAppointmentsByDate',
				description: `
        Get occupied times across doctors in a date range. starts_from is inclusive; starts_to is exclusive.
        For one day use midnight to the next midnight in clinic local time, without a UTC suffix.
        Returns busy times only, never patient details.
        `,
				parameters: dateRange,
				execute: async (range, { abortSignal }) =>
					this.busyTimes(
						await this.client.getAppointments({ ...range, status: 'scheduled' }, abortSignal),
					),
			}),
			llm.tool({
				name: 'getPatientAppointments',
				description: `
        Get appointments for the current patient selected by getPatient or addPatient.
        Returns appointment IDs, doctors, times and statuses.
        Use before choosing a visit to cancel or reschedule; clarify when multiple visits match.
        `,
				parameters: appointmentQuerySchema.pick({
					starts_from: true,
					starts_to: true,
					status: true,
				}),
				execute: async (query, { abortSignal }) =>
					(
						await this.client.getAppointments(
							{ ...query, patient_id: this.patientId() },
							abortSignal,
						)
					).map((appointment) => this.localTimes(appointment)),
			}),
			llm.tool({
				name: 'getDoctorAppointmentsByDate',
				description: `
        Get a doctor’s occupied times in a date range before offering a time. Use a doctor ID from getDoctors.
        Range start is inclusive, end exclusive; local ISO times are interpreted by the server in clinic timezone.
        Returns busy times without patient details, not reserved or guaranteed free slots.
        `,
				parameters: dateRange.extend({ doctor_id: z.uuid() }),
				execute: async (query, { abortSignal }) =>
					this.busyTimes(
						await this.client.getAppointments({ ...query, status: 'scheduled' }, abortSignal),
					),
			}),
			llm.tool({
				name: 'cancelAppointment',
				description: `
        Cancel one current-patient appointment after reviewing the doctor and time and receiving caller confirmation.
        Use an ID from getPatientAppointments. Changes status only; returns the saved appointment.
        `,
				parameters: z.object({ appointment_id: appointmentId }),
				execute: async ({ appointment_id }, { ctx }) => {
					await this.ownAppointment(appointment_id);
					ctx.disallowInterruptions();
					return this.localTimes(
						await this.client.updateAppointment(appointment_id, { status: 'cancelled' }),
					);
				},
			}),
			llm.tool({
				name: 'bookAppointment',
				description: `
        Book a visit for the current patient after checking policy, doctors and occupied times,
        reviewing exact details and receiving confirmation.
        Use local ISO times without offset for clinic local time; server handles DST.
        Returns the saved appointment. Do not retry after an uncertain write.
        `,
				parameters: createAppointmentSchema.omit({ patient_id: true }),
				execute: async (appointment, { ctx }) => {
					const patient_id = this.patientId();
					ctx.disallowInterruptions();
					return this.localTimes(
						await this.client.createAppointment({ ...appointment, patient_id }),
					);
				},
			}),
			llm.tool({
				name: 'rescheduleAppointment',
				description: `
        Move one current-patient appointment after querying their visits, checking the doctor’s target schedule,
        reviewing the old and new time and receiving confirmation. Requeries current-patient appointments before updating.
        Changes times only, preserving doctor and status. Returns the saved appointment; never cancel then recreate.
        `,
				parameters: createAppointmentSchema
					.pick({ starts_at: true, ends_at: true })
					.extend({ appointment_id: appointmentId }),
				execute: async ({ appointment_id, ...times }, { ctx }) => {
					const appointment = await this.ownAppointment(appointment_id);

					if (appointment.status !== 'scheduled') {
						throw new llm.ToolError('A cancelled appointment cannot be rescheduled.');
					}

					ctx.disallowInterruptions();

					return this.localTimes(await this.client.updateAppointment(appointment_id, times));
				},
			}),
		];
	}

	private patientId() {
		if (!this.currentPatient) {
			throw new llm.ToolError('Select the current patient with getPatient or addPatient first.');
		}

		return this.currentPatient.id;
	}

	private async ownAppointment(id: string) {
		const appointments = await this.client.getAppointments({ patient_id: this.patientId() });
		const appointment = appointments.find((a) => a.id === id);

		if (!appointment) {
			throw new llm.ToolError(
				'Appointment not found for the current patient. Refresh their appointment list and clarify the visit.',
			);
		}

		return appointment;
	}

	private busyTimes(appointments: Awaited<ReturnType<ClinicClient['getAppointments']>>) {
		return appointments.map(({ doctor_id, starts_at, ends_at }) =>
			this.localTimes({ doctor_id, starts_at, ends_at }),
		);
	}

	private localTimes<T extends { starts_at: string; ends_at: string }>(appointment: T) {
		const format = new Intl.DateTimeFormat('en-GB', {
			timeZone: 'Europe/Warsaw',
			dateStyle: 'medium',
			timeStyle: 'short',
		});

		return {
			...appointment,
			time_zone: 'Europe/Warsaw',
			starts_at_local: format.format(new Date(appointment.starts_at)),
			ends_at_local: format.format(new Date(appointment.ends_at)),
		};
	}
}
