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
const FakeTimers = require('@sinonjs/fake-timers');
const perfHooks = require('perf_hooks');
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

	for (const hasHistogram of [true, false]) {
		it(`should preserve the committed base lag measurement (histogram: ${hasHistogram})`, t => {
			const clock = FakeTimers.install({
				toFake: [
					'setInterval',
					'clearInterval',
					'setImmediate',
					'clearImmediate',
				],
			});
			t.after(() => {
				register.clear();
				clock.uninstall();
			});
			if (!hasHistogram) {
				const monitorEventLoopDelay = perfHooks.monitorEventLoopDelay;
				perfHooks.monitorEventLoopDelay = undefined;
				t.after(() => {
					perfHooks.monitorEventLoopDelay = monitorEventLoopDelay;
				});
			}
			let elapsedNanoseconds = 0;
			t.mock.method(process, 'hrtime', start => [
				0,
				elapsedNanoseconds - (start ? start[1] : 0),
			]);
			eventLoopLag(register, {
				eventLoopMonitoringPrecision: 10,
				labels: { worker: 'one' },
			});
			const lag = register.getSingleMetric('nodejs_eventloop_lag_seconds');

			assert.strictEqual(clock.countTimers(), hasHistogram ? 1 : 0);
			assert.deepStrictEqual(lag.get().values, []);
			elapsedNanoseconds = 20e6;
			clock.tick(0);
			const firstRead = structuredClone(lag.get());
			assert.deepStrictEqual(firstRead.values, [
				{ value: 0.02, labels: { worker: 'one' } },
			]);
			// Another reader gets the stored sample without consuming it.
			assert.deepStrictEqual(lag.get(), firstRead);
			elapsedNanoseconds += 5e6;
			clock.tick(1);
			assert.strictEqual(lag.get().values[0].value, 0.005);
		});
	}

	it('should stop timers and native monitoring when cleared and reinitialized', t => {
		const { clock, histograms } = mockMonitoring(t, [register]);
		for (let initialization = 0; initialization < 2; initialization++) {
			eventLoopLag(register);
			assert.strictEqual(clock.countTimers(), 1);
			assert.strictEqual(histograms.length, (initialization + 1) * 2);
			for (const histogram of histograms.slice(-2)) {
				assert.strictEqual(histogram.enable.mock.callCount(), 1);
			}

			register.clear();
			register.clear();
			assert.strictEqual(clock.countTimers(), 0);
			for (const histogram of histograms) {
				assert.strictEqual(histogram.disable.mock.callCount(), 1);
			}
		}
	});

	it('should stop monitoring after the last collector metric is removed', t => {
		const { clock, histograms } = mockMonitoring(t, [register]);
		eventLoopLag(register, { prefix: 'worker_' });
		const names = register.getMetricsAsArray().map(metric => metric.name);
		for (const name of names.slice(0, -1)) {
			register.removeSingleMetric(name);
			register.removeSingleMetric(name);
			assert.strictEqual(clock.countTimers(), 1);
		}
		register.removeSingleMetric(names.at(-1));
		assert.strictEqual(clock.countTimers(), 0);
		for (const histogram of histograms) {
			assert.strictEqual(histogram.disable.mock.callCount(), 1);
		}
	});

	it('should keep shared monitoring alive until all registries release it', t => {
		const registries = [register];
		const { clock, histograms } = mockMonitoring(t, registries);
		eventLoopLag(register, { eventLoopMonitoringWindow: 50 });
		const merged = Registry.merge([register]);
		registries.push(merged);
		for (const metric of merged.getMetricsAsArray()) {
			merged.registerMetric(metric);
		}
		register.clear();
		merged.resetMetrics();
		assert.strictEqual(clock.countTimers(), 1);
		clock.tick(50);
		assert.strictEqual(histograms[0].reset.mock.callCount(), 2);
		assert.strictEqual(histograms[0].disable.mock.callCount(), 0);
		assert.strictEqual(merged.getMetricsAsJSON().length, 8);

		merged.clear();
		assert.strictEqual(clock.countTimers(), 0);
		for (const histogram of histograms) {
			assert.strictEqual(histogram.disable.mock.callCount(), 1);
		}
	});

	it('should restart monitoring when removed metrics are registered again', t => {
		const { clock, histograms } = mockMonitoring(t, [register]);
		eventLoopLag(register);
		const metrics = register.getMetricsAsArray();
		register.clear();
		for (const metric of metrics) register.registerMetric(metric);
		assert.strictEqual(clock.countTimers(), 1);
		for (const histogram of histograms) {
			assert.strictEqual(histogram.enable.mock.callCount(), 2);
		}
		register.clear();
		assert.strictEqual(clock.countTimers(), 0);
	});

	it('should release registrations from a failed merge', t => {
		const conflicting = new Registry(regType);
		const { clock, histograms } = mockMonitoring(t, [register, conflicting]);
		eventLoopLag(register);
		eventLoopLag(conflicting);
		assert.throws(
			() => Registry.merge([register, conflicting]),
			/already been registered/,
		);
		assert.strictEqual(clock.countTimers(), 2);
		register.clear();
		conflicting.clear();
		assert.strictEqual(clock.countTimers(), 0);
		for (const histogram of histograms) {
			assert.strictEqual(histogram.disable.mock.callCount(), 1);
		}
	});

	it('should disable histograms if starting monitoring fails', t => {
		const { clock, histograms } = mockMonitoring(t, [register]);
		const setInterval = global.setInterval;
		global.setInterval = () => {
			throw new Error('Cannot start timer');
		};
		try {
			assert.throws(() => eventLoopLag(register), /Cannot start timer/);
		} finally {
			global.setInterval = setInterval;
		}
		assert.strictEqual(clock.countTimers(), 0);
		assert.strictEqual(register.getMetricsAsArray().length, 0);
		for (const histogram of histograms) {
			assert.strictEqual(histogram.disable.mock.callCount(), 1);
		}
	});

	it('should not start monitoring or partially register a conflicting collector', t => {
		const { clock, histograms } = mockMonitoring(t, [register]);
		const Gauge = require('../../lib/gauge');
		const existing = new Gauge({
			name: eventLoopLag.metricNames.at(-1),
			help: 'Existing metric',
			registers: [register],
		});
		assert.throws(() => eventLoopLag(register), /already been registered/);
		assert.strictEqual(clock.countTimers(), 0);
		assert.deepStrictEqual(register.getMetricsAsArray(), [existing]);
		for (const histogram of histograms) {
			assert.strictEqual(histogram.enable.mock.callCount(), 0);
		}
	});

	for (const code of ['ERR_NOT_IMPLEMENTED', 'ERR_MONITORING_FAILED']) {
		for (const failingHistogram of [1, 2]) {
			it(`should clean up histogram ${failingHistogram} startup failure (${code})`, t => {
				const error = Object.assign(new Error('Monitoring unavailable'), {
					code,
				});
				let enableCalls = 0;
				const { clock, histograms } = mockMonitoring(t, [register], () => {
					if (++enableCalls === failingHistogram) throw error;
				});

				if (code === 'ERR_NOT_IMPLEMENTED') {
					assert.doesNotThrow(() => eventLoopLag(register));
				} else {
					assert.throws(
						() => eventLoopLag(register),
						thrown => thrown === error,
					);
				}
				assert.strictEqual(register.getMetricsAsArray().length, 0);
				assert.strictEqual(clock.countTimers(), 0);
				for (const histogram of histograms) {
					assert.strictEqual(histogram.disable.mock.callCount(), 1);
				}
			});
		}
	}

	it('should validate eventLoopMonitoringWindow', () => {
		for (const eventLoopMonitoringWindow of [0, -1, NaN, '10', 2 ** 31]) {
			assert.throws(
				() => eventLoopLag(undefined, { eventLoopMonitoringWindow }),
				RangeError,
			);
		}
	});
});

function mockMonitoring(t, registries, enable = () => {}) {
	const clock = FakeTimers.install({
		toFake: ['setInterval', 'clearInterval'],
	});
	t.after(() => {
		for (const registry of registries) registry.clear();
		t.mock.restoreAll();
		clock.uninstall();
	});
	const histograms = [];
	t.mock.method(perfHooks, 'monitorEventLoopDelay', () => {
		const histogram = {
			enable: t.mock.fn(enable),
			disable: t.mock.fn(),
			reset: t.mock.fn(),
			min: 1e6,
			max: 2e6,
			mean: 1.5e6,
			stddev: 0.5e6,
			percentile: () => 1.5e6,
		};
		histograms.push(histogram);
		return histogram;
	});
	return { clock, histograms };
}

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
