import type { ClinicInformation } from '@clinicline/contracts';
import { CLINIC_TIME_ZONE } from '../../shared/time.js';

export const clinicPolicy: Omit<ClinicInformation, 'now'> = {
	timeZone: CLINIC_TIME_ZONE,
	opensAt: '07:00',
	closesAt: '19:00',
	appointmentMinutes: 30,
	operatingDays: [1, 2, 3, 4, 5],
	bookingHorizon: 30,
} as const;
