'use strict';

const OtelApi = require('@opentelemetry/api');
const Counter = require('../counter');

const PROCESS_CPU_USER_SECONDS = 'process_cpu_user_seconds_total';
const PROCESS_CPU_SYSTEM_SECONDS = 'process_cpu_system_seconds_total';
const PROCESS_CPU_SECONDS = 'process_cpu_seconds_total';

function setCounter(counter, labels, value, exemplarLabels) {
	const previous = counter.store.get(labels) ?? 0;
	counter.store.set(labels, value);
	if (exemplarLabels !== undefined) {
		counter.updateExemplar(labels, exemplarLabels, value - previous);
	}
}

module.exports = (registry, config = {}) => {
	const registers = registry ? [registry] : undefined;
	const namePrefix = config.prefix ? config.prefix : '';
	const labels = config.labels ? config.labels : {};
	const exemplars = config.enableExemplars ? config.enableExemplars : false;
	const labelNames = Object.keys(labels);

	const baseline = process.cpuUsage();

	const cpuUserUsageCounter = new Counter({
		name: namePrefix + PROCESS_CPU_USER_SECONDS,
		help: 'Total user CPU time spent in seconds.',
		enableExemplars: exemplars,
		registers,
		labelNames,
		// Use this one metric's `collect` to set all metrics' values.
		collect() {
			// Derive the totals from the baseline instead of accumulating deltas
			// between reads, so the value never depends on how often (or whether)
			// the metric was read before, including after a registry reset.
			const { user, system } = process.cpuUsage(baseline);

			let exemplarLabels;
			if (this.enableExemplars) {
				exemplarLabels = {};
				const currentSpan = OtelApi.trace.getSpan(OtelApi.context.active());
				if (currentSpan) {
					exemplarLabels = {
						traceId: currentSpan.spanContext().traceId,
						spanId: currentSpan.spanContext().spanId,
					};
				}
			}

			setCounter(cpuUserUsageCounter, labels, user / 1e6, exemplarLabels);
			setCounter(cpuSystemUsageCounter, labels, system / 1e6, exemplarLabels);
			setCounter(
				cpuUsageCounter,
				labels,
				(user + system) / 1e6,
				exemplarLabels,
			);
		},
	});
	const cpuSystemUsageCounter = new Counter({
		name: namePrefix + PROCESS_CPU_SYSTEM_SECONDS,
		help: 'Total system CPU time spent in seconds.',
		enableExemplars: exemplars,
		registers,
		labelNames,
	});
	const cpuUsageCounter = new Counter({
		name: namePrefix + PROCESS_CPU_SECONDS,
		help: 'Total user and system CPU time spent in seconds.',
		enableExemplars: exemplars,
		registers,
		labelNames,
	});
};

module.exports.metricNames = [
	PROCESS_CPU_USER_SECONDS,
	PROCESS_CPU_SYSTEM_SECONDS,
	PROCESS_CPU_SECONDS,
];
