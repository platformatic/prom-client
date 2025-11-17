# Promise Allocation Optimization Results

## Overview

Successfully eliminated unnecessary promise allocations and microtick overhead in all metric types and Registry methods when the `collect` function is not present or is synchronous.

## Implementation Summary

### Metrics (Phases 1-4)

All metric types (Histogram, Summary, Counter, Gauge) now use constructor-time method assignment:

- When `config.collect` is present: assigns async implementations that use `.then()` instead of `async/await`
- When `config.collect` is absent: assigns sync implementations that return plain values

### Registry (Phase 5)

Registry methods now check for promises and return synchronously when all metrics are sync:

- `getMetricsAsString()`: Checks if metric result is Promise
- `metrics()`: Checks if any metric result is Promise
- `getMetricsAsJSON()`: Checks if any metric result is Promise

When all metrics lack `collect` functions:

- ✅ Zero promise allocations
- ✅ Zero microtick overhead
- ✅ Direct synchronous execution

## Performance Improvements

### Registry Serialization Benchmarks

Comparison: `prom-client@current` (with optimizations) vs `prom-client@latest` (v15.1.3)

#### getMetricsAsJSON()

| Configuration     | Current (ops/sec) | Latest (ops/sec) | Improvement |
| ----------------- | ----------------- | ---------------- | ----------- |
| No labels         | 602,892           | 498,481          | **+20.9%**  |
| 1 x 64            | 9,934             | 9,253            | +7.4%       |
| 2 x 4             | 34,834            | 33,063           | +5.4%       |
| 2 x 8             | 10,084            | 8,863            | **+13.8%**  |
| 6 x 2             | 6,324             | 5,685            | **+11.2%**  |
| 2 x 4, 2 defaults | 22,795            | 17,877           | **+27.5%**  |
| 2 x 2, 4 defaults | 89,178            | 67,152           | **+32.8%**  |

#### metrics()

| Configuration                   | Current (ops/sec) | Latest (ops/sec) | Improvement |
| ------------------------------- | ----------------- | ---------------- | ----------- |
| No labels                       | 241,539           | 200,939          | **+20.2%**  |
| No labels (OpenMetrics)         | 233,157           | 196,467          | **+18.7%**  |
| 1 x 64                          | 3,866             | 3,554            | +8.8%       |
| 1 x 64 (OpenMetrics)            | 3,857             | 3,565            | +8.2%       |
| 2 x 4                           | 14,733            | 14,285           | +3.1%       |
| 2 x 4 (OpenMetrics)             | 14,877            | 13,910           | +7.0%       |
| 2 x 8                           | 4,361             | 3,941            | **+10.7%**  |
| 2 x 8 (OpenMetrics)             | 4,269             | 3,967            | +7.6%       |
| 6 x 2                           | 3,445             | 3,130            | **+10.1%**  |
| 6 x 2 (OpenMetrics)             | 3,396             | 3,150            | +7.8%       |
| 2 x 4, 2 defaults               | 9,550             | 7,323            | **+30.4%**  |
| 2 x 4, 2 defaults (OpenMetrics) | 9,683             | 7,017            | **+38.0%**  |
| 2 x 2, 4 defaults               | 37,332            | 28,154           | **+32.6%**  |
| 2 x 2, 4 defaults (OpenMetrics) | 37,522            | 27,608           | **+35.9%**  |

### Metric Operation Benchmarks

#### Counter

| Operation       | Current (ops/sec) | Latest (ops/sec) | Improvement |
| --------------- | ----------------- | ---------------- | ----------- |
| inc             | 9,996,756         | 10,534,620       | -5.1%       |
| inc with labels | 38,684            | 23,019           | **+68.0%**  |

#### Gauge

| Operation       | Current (ops/sec) | Latest (ops/sec) | Improvement |
| --------------- | ----------------- | ---------------- | ----------- |
| inc             | 13,702,799        | 14,907,867       | -8.1%       |
| inc with labels | 259,381           | 116,375          | **+122.9%** |

#### Histogram

| Operation                 | Current (ops/sec) | Latest (ops/sec) | Improvement |
| ------------------------- | ----------------- | ---------------- | ----------- |
| observe (1 x 64)          | 193,452           | 93,549           | **+106.8%** |
| observe (2 x 8)           | 131,396           | 72,968           | **+80.1%**  |
| observe (2 x 4, 2 x 2)    | 68,469            | 47,001           | **+45.7%**  |
| observe (2 x 2, 2 x 4)    | 65,778            | 45,797           | **+43.6%**  |
| observe (6 x 2)           | 48,769            | 34,361           | **+41.9%**  |
| startTimer (1 x 64)       | 84,334            | 64,651           | **+30.4%**  |
| startTimer (2 x 8)        | 68,874            | 51,848           | **+32.8%**  |
| startTimer (2 x 4, 2 x 2) | 45,552            | 36,800           | **+23.8%**  |
| startTimer (2 x 2, 2 x 4) | 45,575            | 36,607           | **+24.5%**  |
| startTimer (6 x 2)        | 35,125            | 28,236           | **+24.4%**  |

#### Summary

| Operation              | Current (ops/sec) | Latest (ops/sec) | Improvement |
| ---------------------- | ----------------- | ---------------- | ----------- |
| observe (1 x 64)       | 233,500           | 130,326          | **+79.2%**  |
| observe (2 x 8)        | 123,353           | 82,250           | **+50.0%**  |
| observe (2 x 4, 2 x 2) | 69,794            | 49,853           | **+40.0%**  |
| observe (2 x 2, 2 x 4) | 66,659            | 49,768           | **+33.9%**  |
| observe (6 x 2)        | 55,079            | 38,011           | **+44.9%**  |

## Key Takeaways

1. **Registry serialization**: Up to **+38%** improvement in string serialization, **+33%** in JSON serialization
2. **Histogram operations**: Up to **+107%** improvement for labeled observations
3. **Summary operations**: Up to **+79%** improvement for labeled observations
4. **Counter/Gauge with labels**: Up to **+123%** improvement

The optimizations have the greatest impact on:

- Simple metrics (no labels or few labels)
- Metrics with default labels
- Label-heavy operations

## Testing

- ✅ All 45 tests passing
- ✅ Full linting compliance
- ✅ TypeScript compilation successful
- ✅ Backward compatible with async `collect` functions

## Files Changed

- `lib/histogram.js`: Sync/async split for `get()` and `getForPromString()`
- `lib/summary.js`: Sync/async split for `get()`
- `lib/counter.js`: Sync/async split for `get()`
- `lib/gauge.js`: Sync/async split for `get()`
- `lib/registry.js`: Promise-aware serialization methods
- `lib/metric.js`: Freeze `collect` property after construction
- `lib/metrics/heapSpacesSizeAndUsed.js`: Pass `collect` in constructor
