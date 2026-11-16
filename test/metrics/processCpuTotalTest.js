'use strict';

const { it, beforeEach, afterEach, before } = require('node:test');
const assert = require('node:assert');
const { describeEach } = require('../helpers');

const Registry = require('../../index').Registry;

describeEach([
	['Prometheus', Registry.PROMETHEUS_CONTENT_TYPE],
	['OpenMetrics', Registry.OPENMETRICS_CONTENT_TYPE],
])('processCpuTotal with %s registry', (tag, regType) => {
	const register = require('../../index').register;
	const processCpuTotal = require('../../lib/metrics/processCpuTotal');

	before(() => {
		register.clear();
	});

	beforeEach(() => {
		register.setContentType(regType);
	});

	afterEach(() => {
		register.clear();
	});

	it(`should add metrics to the ${tag} registry`, async () => {
		assert.strictEqual((await register.getMetricsAsJSON()).length, 0);
		processCpuTotal();

		const metrics = await register.getMetricsAsJSON();
		assert.deepStrictEqual(
			metrics.map(m => [m.name, m.type]),
			[
				['process_cpu_user_seconds_total', 'counter'],
				['process_cpu_system_seconds_total', 'counter'],
				['process_cpu_seconds_total', 'counter'],
			],
		);
	});

	it('should not depend on previous reads', async () => {
		processCpuTotal();
		burnCpu(50);
		const first = totals(await register.getMetricsAsJSON());
		assert.ok(first.process_cpu_seconds_total >= 0.02);

		// Accumulating deltas between reads made the value after a reset depend
		// on when the previous read happened.
		register.resetMetrics();
		const second = totals(await register.getMetricsAsJSON());

		for (const name of Object.keys(first)) {
			assert.ok(second[name] >= first[name], name);
		}
		assert.ok(
			Math.abs(
				second.process_cpu_seconds_total -
					second.process_cpu_user_seconds_total -
					second.process_cpu_system_seconds_total,
			) < 1e-9,
		);
	});
});

function burnCpu(ms) {
	const end = Date.now() + ms;
	while (Date.now() < end);
}

function totals(metrics) {
	const result = {};
	for (const metric of metrics) {
		result[metric.name] = metric.values[0].value;
	}
	return result;
}
