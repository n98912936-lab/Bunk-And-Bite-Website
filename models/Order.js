const mongoose = require("mongoose");
// This schema intentionally uses Mixed (flexible) types for items/totals/
// address/outlet, matching the loose JSON shape server.js already builds.
// You can tighten this later once the data structure is finalized.
const orderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  customer: {
    name: { type: String, required: true },
    phone: { type: String, required: true, index: true },
    email: { type: String, required: true }
  },
  items: { type: mongoose.Schema.Types.Mixed, required: true },
  totals: { type: mongoose.Schema.Types.Mixed, required: true },
  address: { type: mongoose.Schema.Types.Mixed, required: true },
  outlet: { type: mongoose.Schema.Types.Mixed, required: true },
  paymentMethod: { type: String, enum: ["cod", "online"], required: true },
  paymentStatus: { type: String, default: "pending_cod" },
  status: {
    type: String,
    enum: ["placed", "confirmed", "preparing", "ready", "outfordelivery", "delivered", "cancelled"],
    default: "placed"
  },
  placedAt: { type: Date, default: Date.now },
  etaMins: { type: Number, default: 35 },
  razorpayOrderId: { type: String },
  razorpayPaymentId: { type: String },
  paidAt: { type: Date },
  updatedAt: { type: Date }
});
module.exports = mongoose.model("Order", orderSchema);
