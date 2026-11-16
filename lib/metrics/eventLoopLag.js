'use strict';

const Gauge = require('../gauge');

// Check if perf_hooks module is available
let perf_hooks;
try {
	perf_hooks = require('perf_hooks');
} catch {
	// node version is too old
}

// Reported always.
const NODEJS_EVENTLOOP_LAG = 'nodejs_eventloop_lag_seconds';

// Reported only when perf_hooks is available.
const NODEJS_EVENTLOOP_LAG_MIN = 'nodejs_eventloop_lag_min_seconds';
const NODEJS_EVENTLOOP_LAG_MAX = 'nodejs_eventloop_lag_max_seconds';
const NODEJS_EVENTLOOP_LAG_MEAN = 'nodejs_eventloop_lag_mean_seconds';
const NODEJS_EVENTLOOP_LAG_STDDEV = 'nodejs_eventloop_lag_stddev_seconds';
const NODEJS_EVENTLOOP_LAG_P50 = 'nodejs_eventloop_lag_p50_seconds';
const NODEJS_EVENTLOOP_LAG_P90 = 'nodejs_eventloop_lag_p90_seconds';
const NODEJS_EVENTLOOP_LAG_P99 = 'nodejs_eventloop_lag_p99_seconds';

const DEFAULT_EVENTLOOP_MONITORING_WINDOW = 60000;
// Largest delay setInterval accepts before falling back to 1ms.
const MAX_TIMER = 2 ** 31 - 1;

function reportEventloopLag(start, gauge, labels) {
	const delta = process.hrtime(start);
	const nanosec = delta[0] * 1e9 + delta[1];
	const seconds = nanosec / 1e9;

	gauge.set(labels, seconds);
}

module.exports = (registry, config = {}) => {
	const namePrefix = config.prefix ? config.prefix : '';
	const labels = config.labels ? config.labels : {};
	const labelNames = Object.keys(labels);
	const registers = registry ? [registry] : undefined;

	let collect = () => {
		const start = process.hrtime();
		setImmediate(reportEventloopLag, start, lag, labels);
	};

	if (perf_hooks && perf_hooks.monitorEventLoopDelay) {
		const windowMs =
			config.eventLoopMonitoringWindow ?? DEFAULT_EVENTLOOP_MONITORING_WINDOW;
		if (!(Number.isFinite(windowMs) && windowMs > 0 && windowMs <= MAX_TIMER)) {
			throw new RangeError(
				`eventLoopMonitoringWindow must be a number between 1 and ${MAX_TIMER}, got ${windowMs}`,
			);
		}

		try {
			// Reading the stats must never reset them, otherwise every scrape (or
			// any other reader, such as a second Prometheus server) would steal
			// samples from the next one. Instead, two histograms are reset on a
			// timer, staggered by one window: the one being reported always holds
			// between one and two windows of the most recent samples.
			const histograms = [
				perf_hooks.monitorEventLoopDelay({
					resolution: config.eventLoopMonitoringPrecision,
				}),
				perf_hooks.monitorEventLoopDelay({
					resolution: config.eventLoopMonitoringPrecision,
				}),
			];
			histograms[0].enable();
			histograms[1].enable();
			let oldest = 0;

			setInterval(() => {
				histograms[oldest].reset();
				oldest ^= 1;
			}, windowMs).unref();

			collect = () => {
				const start = process.hrtime();
				setImmediate(reportEventloopLag, start, lag, labels);

				const histogram = histograms[oldest];
				lagMin.set(labels, histogram.min / 1e9);
				lagMax.set(labels, histogram.max / 1e9);
				lagMean.set(labels, histogram.mean / 1e9);
				lagStddev.set(labels, histogram.stddev / 1e9);
				lagP50.set(labels, histogram.percentile(50) / 1e9);
				lagP90.set(labels, histogram.percentile(90) / 1e9);
				lagP99.set(labels, histogram.percentile(99) / 1e9);
			};
		} catch (e) {
			if (e.code === 'ERR_NOT_IMPLEMENTED') {
				return; // Bun
			}

			throw e;
		}
	}

	const lag = new Gauge({
		name: namePrefix + NODEJS_EVENTLOOP_LAG,
		help: 'Lag of event loop in seconds.',
		registers,
		labelNames,
		aggregator: 'average',
		// Use this one metric's `collect` to set all metrics' values.
		collect,
	});
	const lagMin = new Gauge({
		name: namePrefix + NODEJS_EVENTLOOP_LAG_MIN,
		help: 'The minimum recorded event loop delay.',
		registers,
		labelNames,
		aggregator: 'min',
	});
	const lagMax = new Gauge({
		name: namePrefix + NODEJS_EVENTLOOP_LAG_MAX,
		help: 'The maximum recorded event loop delay.',
		registers,
		labelNames,
		aggregator: 'max',
	});
	const lagMean = new Gauge({
		name: namePrefix + NODEJS_EVENTLOOP_LAG_MEAN,
		help: 'The mean of the recorded event loop delays.',
		registers,
		labelNames,
		aggregator: 'average',
	});
	const lagStddev = new Gauge({
		name: namePrefix + NODEJS_EVENTLOOP_LAG_STDDEV,
		help: 'The standard deviation of the recorded event loop delays.',
		registers,
		labelNames,
		aggregator: 'average',
	});
	const lagP50 = new Gauge({
		name: namePrefix + NODEJS_EVENTLOOP_LAG_P50,
		help: 'The 50th percentile of the recorded event loop delays.',
		registers,
		labelNames,
		aggregator: 'average',
	});
	const lagP90 = new Gauge({
		name: namePrefix + NODEJS_EVENTLOOP_LAG_P90,
		help: 'The 90th percentile of the recorded event loop delays.',
		registers,
		labelNames,
		aggregator: 'average',
	});
	const lagP99 = new Gauge({
		name: namePrefix + NODEJS_EVENTLOOP_LAG_P99,
		help: 'The 99th percentile of the recorded event loop delays.',
		registers,
		labelNames,
		aggregator: 'average',
	});
};

module.exports.metricNames = [
	NODEJS_EVENTLOOP_LAG,
	NODEJS_EVENTLOOP_LAG_MIN,
	NODEJS_EVENTLOOP_LAG_MAX,
	NODEJS_EVENTLOOP_LAG_MEAN,
	NODEJS_EVENTLOOP_LAG_STDDEV,
	NODEJS_EVENTLOOP_LAG_P50,
	NODEJS_EVENTLOOP_LAG_P90,
	NODEJS_EVENTLOOP_LAG_P99,
];
