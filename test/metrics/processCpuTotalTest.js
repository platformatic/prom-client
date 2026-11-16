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

	it('should not depend on previous reads', async t => {
		let cpuUsage = { user: 1000000, system: 2000000 };
		t.mock.method(process, 'cpuUsage', (previous = { user: 0, system: 0 }) => {
			return {
				user: cpuUsage.user - previous.user,
				system: cpuUsage.system - previous.system,
			};
		});
		processCpuTotal();
		cpuUsage = { user: 1030000, system: 2020000 };
		const first = totals(await register.getMetricsAsJSON());
		assert.deepStrictEqual(first, {
			process_cpu_user_seconds_total: 0.03,
			process_cpu_system_seconds_total: 0.02,
			process_cpu_seconds_total: 0.05,
		});

		// Accumulating deltas between reads made the value after a reset depend
		// on when the previous read happened.
		register.resetMetrics();
		const second = totals(await register.getMetricsAsJSON());

		assert.deepStrictEqual(second, first);

		cpuUsage = { user: 1050000, system: 2030000 };
		assert.deepStrictEqual(totals(await register.getMetricsAsJSON()), {
			process_cpu_user_seconds_total: 0.05,
			process_cpu_system_seconds_total: 0.03,
			process_cpu_seconds_total: 0.08,
		});
	});
});

function totals(metrics) {
	const result = {};
	for (const metric of metrics) {
		result[metric.name] = metric.values[0].value;
	}
	return result;
}
