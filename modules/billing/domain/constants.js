// Fixed vocabulary of the billing module (docs/billing/REQUIREMENTS.md sections 5 and 6).
// Feature and limit keys are owned by the host product: the module stores them, it does not interpret them.

const PRICING_MODELS = ['PER_UNIT', 'PER_ACCOUNT', 'ONE_TIME'];
const CYCLES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'CUSTOM'];
const DISCOUNT_TYPES = ['PERCENT', 'FIXED']; // PERCENT in hundredths (1500 = 15.00%), FIXED in minor units
const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'];

const UNLIMITED = -1;
const CODE_RE = /^[a-z][a-z0-9_]{1,29}$/; // plan codes, feature and limit keys
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_MONEY_MINOR = 100000000000; // 1,000,000,000.00 INR: far above any real price, keeps the maths inside safe integers

const isDate = (d) => typeof d === 'string' && DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
  && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

module.exports = { PRICING_MODELS, CYCLES, DISCOUNT_TYPES, SUBSCRIPTION_STATUSES, UNLIMITED, CODE_RE, DATE_RE, MAX_MONEY_MINOR, isDate };
