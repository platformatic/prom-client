'use strict';

// Metrics in a collector share resources, including across merged registries.
const resourcesByMetric = new WeakMap();

function bindMetricResources(metrics, start, stop) {
	const resources = { registrations: 0, start, stop };
	for (const metric of metrics) {
		resourcesByMetric.set(metric, resources);
	}
}

function retainMetricResources(metric) {
	const resources = resourcesByMetric.get(metric);
	if (!resources) return;
	if (resources.registrations === 0) {
		try {
			resources.start();
		} catch (error) {
			resources.stop();
			throw error;
		}
	}
	resources.registrations++;
}

function releaseMetricResources(metric) {
	const resources = resourcesByMetric.get(metric);
	if (!resources) return;
	resources.registrations--;
	if (resources.registrations === 0) resources.stop();
}

module.exports = {
	bindMetricResources,
	retainMetricResources,
	releaseMetricResources,
};
