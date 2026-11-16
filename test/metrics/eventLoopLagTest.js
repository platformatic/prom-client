'use strict';

const {
	describe,
	it,
	beforeEach,
	afterEach,
	before,
	after,
} = require('node:test');
const assert = require('node:assert');
const { describeEach, wait } = require('../helpers');

const Registry = require('../../index').Registry;

describeEach([
	['Prometheus', Registry.PROMETHEUS_CONTENT_TYPE],
	['OpenMetrics', Registry.OPENMETRICS_CONTENT_TYPE],
])('eventLoopLag with %s registry', (tag, regType) => {
	const register = require('../../index').register;
	const eventLoopLag = require('../../lib/metrics/eventLoopLag');

	before(() => {
		register.clear();
	});

	beforeEach(() => {
		register.setContentType(regType);
	});

	afterEach(() => {
		register.clear();
	});

	it(`should add metric to the ${tag} registry`, async () => {
		assert.strictEqual((await register.getMetricsAsJSON()).length, 0);
		eventLoopLag();

		await wait(5);

		const metrics = await register.getMetricsAsJSON();
		assert.strictEqual(metrics.length, 8);

		assert.strictEqual(metrics[0].help, 'Lag of event loop in seconds.');
		assert.strictEqual(metrics[0].type, 'gauge');
		assert.strictEqual(metrics[0].name, 'nodejs_eventloop_lag_seconds');

		assert.strictEqual(
			metrics[1].help,
			'The minimum recorded event loop delay.',
		);
		assert.strictEqual(metrics[1].type, 'gauge');
		assert.strictEqual(metrics[1].name, 'nodejs_eventloop_lag_min_seconds');

		assert.strictEqual(
			metrics[2].help,
			'The maximum recorded event loop delay.',
		);
		assert.strictEqual(metrics[2].type, 'gauge');
		assert.strictEqual(metrics[2].name, 'nodejs_eventloop_lag_max_seconds');

		assert.strictEqual(
			metrics[3].help,
			'The mean of the recorded event loop delays.',
		);
		assert.strictEqual(metrics[3].type, 'gauge');
		assert.strictEqual(metrics[3].name, 'nodejs_eventloop_lag_mean_seconds');

		assert.strictEqual(
			metrics[4].help,
			'The standard deviation of the recorded event loop delays.',
		);
		assert.strictEqual(metrics[4].type, 'gauge');
		assert.strictEqual(metrics[4].name, 'nodejs_eventloop_lag_stddev_seconds');

		assert.strictEqual(
			metrics[5].help,
			'The 50th percentile of the recorded event loop delays.',
		);
		assert.strictEqual(metrics[5].type, 'gauge');
		assert.strictEqual(metrics[5].name, 'nodejs_eventloop_lag_p50_seconds');

		assert.strictEqual(
			metrics[6].help,
			'The 90th percentile of the recorded event loop delays.',
		);
		assert.strictEqual(metrics[6].type, 'gauge');
		assert.strictEqual(metrics[6].name, 'nodejs_eventloop_lag_p90_seconds');

		assert.strictEqual(
			metrics[7].help,
			'The 99th percentile of the recorded event loop delays.',
		);
		assert.strictEqual(metrics[7].type, 'gauge');
		assert.strictEqual(metrics[7].name, 'nodejs_eventloop_lag_p99_seconds');
	});

	it('should not reset the delay statistics when read', async () => {
		eventLoopLag(undefined, { eventLoopMonitoringPrecision: 1 });
		// The histograms only start recording after their first tick.
		await wait(10);
		block(50);
		await wait(20);

		// Reads happen back to back, so no new sample can land in between.
		const first = statsFrom(await register.getMetricsAsJSON());
		const second = statsFrom(await register.getMetricsAsJSON());

		assert.ok(first.nodejs_eventloop_lag_max_seconds > 0.02);
		assert.deepStrictEqual(second, first);
	});

	it('should drop old samples after the monitoring window, not on read', async () => {
		eventLoopLag(undefined, {
			eventLoopMonitoringPrecision: 1,
			eventLoopMonitoringWindow: 50,
		});
		await wait(10);
		block(200);
		await wait(5);

		const during = statsFrom(await register.getMetricsAsJSON());
		assert.ok(during.nodejs_eventloop_lag_max_seconds > 0.1);

		// Both histograms have been reset at least once since the block.
		await wait(300);
		const after = statsFrom(await register.getMetricsAsJSON());
		assert.ok(after.nodejs_eventloop_lag_max_seconds < 0.1);
	});

	it('should validate eventLoopMonitoringWindow', () => {
		for (const eventLoopMonitoringWindow of [0, -1, NaN, '10', 2 ** 31]) {
			assert.throws(
				() => eventLoopLag(undefined, { eventLoopMonitoringWindow }),
				RangeError,
			);
		}
	});
});

function block(ms) {
	const end = Date.now() + ms;
	while (Date.now() < end);
}

function statsFrom(metrics) {
	const stats = {};
	for (const metric of metrics) {
		if (metric.name !== 'nodejs_eventloop_lag_seconds') {
			stats[metric.name] = metric.values[0].value;
		}
	}
	return stats;
}
