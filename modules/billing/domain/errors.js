// One error type for the module. Routes turn it into { error, code, field? } with its HTTP status.
// Codes are stable (docs/billing/REQUIREMENTS.md section 7.3); the screens map them to text.
class BillingError extends Error {
  constructor(status, code, message, field) {
    super(message || code);
    this.status = status;
    this.code = code;
    if (field) this.field = field;
  }
}

const bad = (code, message, field) => new BillingError(400, code, message, field);
const notFound = (message = 'Not found.') => new BillingError(404, 'notfound', message);
const conflict = (code, message) => new BillingError(409, code, message);

module.exports = { BillingError, bad, notFound, conflict };
