const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  category: { type: String, required: true },
  desc: { type: String, default: "" },
  veg: { type: Boolean, default: true },
  available: { type: Boolean, default: true },
  featured: { type: Boolean, default: false },
  rating: { type: Number, default: 4.0 },
  emoji: { type: String, default: "🍽️" },
  img: { type: String, default: "" },
  customizable: { type: Boolean, default: false },
  price: { type: Number },
  prices: {
    small: Number,
    medium: Number,
    large: Number
  },
  comboPizzaCount: Number
}, { timestamps: true });

module.exports = mongoose.model("Product", productSchema);
