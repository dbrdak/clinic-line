import {
	appointmentSchema,
	clinicInformationSchema,
	doctorSchema,
	type Appointment,
	type AppointmentQuerySchema,
	type ClinicInformation,
	type CreateAppointmentRequest,
	type CreatePatientRequest,
	type Doctor,
	type UpdateAppointmentRequest,
} from '@clinicline/contracts';
import { patientSchema, type Patient } from '@clinicline/contracts/patients';
import type { z } from 'zod';

export class ClinicClient {
	private readonly baseUrl: URL;
	private readonly fetcher: typeof fetch;

	constructor(
		url = process.env.CLINIC_API_URL ?? 'http://localhost:3000/api',
		fetcher: typeof fetch = fetch,
	) {
		this.fetcher = fetcher;
		this.baseUrl = new URL(url.replace(/\/+$/, ''));
	}

	getClinicPolicy(signal?: AbortSignal): Promise<ClinicInformation> {
		return this.sendRequest('get', '/clinic', clinicInformationSchema, signal);
	}

	getPatients(signal?: AbortSignal): Promise<Patient[]> {
		return this.sendRequest('get', '/patients', patientSchema.array(), signal);
	}

	getPatient(id: string, signal?: AbortSignal): Promise<Patient> {
		return this.sendRequest('get', `/patients/${id}`, patientSchema, signal);
	}

	addPatient(patient: CreatePatientRequest, signal?: AbortSignal): Promise<Patient> {
		return this.sendRequest('post', '/patients', patientSchema, signal, patient);
	}

	getDoctors(signal?: AbortSignal): Promise<Doctor[]> {
		return this.sendRequest('get', '/doctors', doctorSchema.array(), signal);
	}

	getAppointments(query: AppointmentQuerySchema, signal?: AbortSignal): Promise<Appointment[]> {
		const params = new URLSearchParams();

		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined && value !== '') {
				params.set(key, value);
			}
		}

		const search = params.toString();

		return this.sendRequest(
			'get',
			`/appointments${search ? `?${search}` : ''}`,
			appointmentSchema.array(),
			signal,
		);
	}

	getAppointment(id: string, signal?: AbortSignal): Promise<Appointment> {
		return this.sendRequest('get', `/appointments/${id}`, appointmentSchema, signal);
	}

	createAppointment(
		appointment: CreateAppointmentRequest,
		signal?: AbortSignal,
	): Promise<Appointment> {
		return this.sendRequest('post', '/appointments', appointmentSchema, signal, appointment);
	}

	updateAppointment(
		appointmentId: string,
		updatedFields: UpdateAppointmentRequest,
		signal?: AbortSignal,
	): Promise<Appointment> {
		return this.sendRequest(
			'patch',
			`/appointments/${appointmentId}`,
			appointmentSchema,
			signal,
			updatedFields,
		);
	}

	private async sendRequest<T>(
		method: 'get' | 'post' | 'patch' | 'delete',
		path: string,
		schema: z.ZodType<T>,
		signal?: AbortSignal,
		body?: unknown,
	): Promise<T> {
		const timeout = AbortSignal.timeout(5_000);

		const response = await this.fetcher(`${this.baseUrl.href}${path}`, {
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			method: method.toUpperCase(),
			body: JSON.stringify(body),
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});

		if (!response.ok) {
			throw new Error(`Clinic API request failed (HTTP ${response.status}).`);
		}

		const result = schema.safeParse(await response.json());
		if (!result.success) throw new Error('Clinic API returned an invalid response.');
		return result.data;
	}
}
