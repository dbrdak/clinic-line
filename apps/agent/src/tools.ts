import ClinicTools from './clinic/clinic.tools.ts';

export function registerTools() {
	const clinicTools = new ClinicTools();

	return [...clinicTools.register()];
}
