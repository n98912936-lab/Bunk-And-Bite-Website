const mongoose = require("mongoose");

// Stores one active OTP per email at a time.
// The TTL index below tells MongoDB to auto-delete the document once
// `expiresAt` has passed — so we never need a manual cleanup job.
const emailOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  otp: { type: String, required: true },
  verified: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
});

module.exports = mongoose.model("EmailOtp", emailOtpSchema);
