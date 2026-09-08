const express = require("express");
const crypto = require("crypto");
const path = require("path");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const nodemailer = require("nodemailer");
const Order = require("./models/Order");
const Product = require("./models/Product");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------- Email notification setup ----------------
// Sends an email to the shop owner every time a new order comes in.
// Uses a Gmail account + an "App Password" (set in .env / Render env vars).
let mailer = null;
if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  mailer = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    family: 4, // force IPv4 — Render's network can't reach Gmail over IPv6
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
} else {
  console.warn("Email notifications are OFF. Add GMAIL_USER and GMAIL_APP_PASSWORD to .env to enable them.");
}

async function sendOrderEmail(order) {
  if (!mailer) return;
  const itemsList = order.items
    .map(it => `- ${it.name} x${it.qty} (₹${it.lineTotal ?? ""})`)
    .join("\n");
  const notifyTo = process.env.NOTIFY_EMAIL || process.env.GMAIL_USER;
  try {
    await mailer.sendMail({
      from: `"Bunk And Bite" <${process.env.GMAIL_USER}>`,
      to: notifyTo,
      subject: `🍕 New Order ${order.id} — ₹${order.totals?.grandTotal ?? ""}`,
      text:
`New order received!

Order ID: ${order.id}
Customer: ${order.customer.name} (${order.customer.phone})
Payment: ${order.paymentMethod.toUpperCase()}
Address: ${order.address?.text || ""}

Items:
${itemsList}

Grand Total: ₹${order.totals?.grandTotal ?? ""}`
    });
    console.log(`Notification email sent for order ${order.id}`);
  } catch (e) {
    console.error("Failed to send notification email:", e.message);
  }
}

// ---------------- Database connection ----------------
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is missing in .env. Add your MongoDB Atlas connection string.");
  process.exit(1);
}
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

async function nextOrderNumber() {
  const d = new Date();
  const prefix = `BB-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
  const countToday = await Order.countDocuments({ id: { $regex: `^${prefix}` } });
  return `${prefix}-${String(countToday + 1).padStart(4,"0")}`;
}
function validPhone(phone) {
  return /^[6-9]\d{9}$/.test(String(phone || ""));
}

// ---------------- Admin auth ----------------
// The admin panel sends the password back on every request in the
// 'x-admin-key' header. We just compare it to ADMIN_PASSWORD in .env.
function requireAdmin(req, res, next) {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ error: "Admin panel is not configured. Add ADMIN_PASSWORD to .env." });
  }
  const key = req.header("x-admin-key");
  if (!key || key !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid admin password." });
  }
  next();
}

app.get("/api/health", (req,res) => {
  res.json({
    ok: true,
    dbConnected: mongoose.connection.readyState === 1,
    paymentConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    adminConfigured: Boolean(process.env.ADMIN_PASSWORD),
    emailConfigured: Boolean(mailer)
  });
});

app.post("/api/admin/login", (req, res) => {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ error: "Admin panel is not configured. Add ADMIN_PASSWORD to .env." });
  }
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  res.json({ ok: true });
});

// ---------------- Products (public read) ----------------
app.get("/api/products", async (req, res) => {
  const products = await Product.find().sort({ category: 1, name: 1 });
  res.json(products);
});

// ---------------- Products (admin write) ----------------
app.post("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const body = req.body;
    if (!body.id || !body.name || !body.category) {
      return res.status(400).json({ error: "id, name and category are required." });
    }
    const exists = await Product.findOne({ id: body.id });
    if (exists) return res.status(400).json({ error: "A product with this id already exists." });
    const product = await Product.create(body);
    res.status(201).json(product);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Unable to create product." });
  }
});

app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { id: req.params.id },
      { $set: req.body },
      { new: true }
    );
    if (!product) return res.status(404).json({ error: "Product not found." });
    res.json(product);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Unable to update product." });
  }
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const result = await Product.findOneAndDelete({ id: req.params.id });
  if (!result) return res.status(404).json({ error: "Product not found." });
  res.json({ ok: true });
});

// ---------------- Orders ----------------
app.post("/api/orders", async (req,res) => {
  try {
    const { customer, items, totals, address, outlet, paymentMethod } = req.body;
    if (!customer?.name || !validPhone(customer.phone)) return res.status(400).json({error:"Valid customer name and 10-digit mobile number are required."});
    if (!Array.isArray(items) || !items.length) return res.status(400).json({error:"Cart is empty."});
    if (!address?.text) return res.status(400).json({error:"Delivery address is required."});
    if (!outlet?.id) return res.status(400).json({error:"Outlet is required."});

    // IMPORTANT: In a production deployment, calculate prices again from the database here.
    // Never trust totals sent by the browser.
    const orderId = await nextOrderNumber();
    const order = new Order({
      id: orderId,
      customer: { name: String(customer.name).slice(0,100), phone: String(customer.phone) },
      items,
      totals,
      address,
      outlet,
      paymentMethod: paymentMethod === "cod" ? "cod" : "online",
      paymentStatus: paymentMethod === "cod" ? "pending_cod" : "created",
      status: "placed",
      placedAt: new Date(),
      etaMins: 35
    });

    await order.save();

    // Real online payment order creation.
    if (order.paymentMethod === "online") {
      if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        return res.status(503).json({
          error:"Online payment is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env, or choose COD."
        });
      }
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });
      const rpOrder = await razorpay.orders.create({
        amount: Math.round(Number(totals.grandTotal) * 100),
        currency: "INR",
        receipt: order.id,
        notes: { order_id: order.id }
      });
      order.razorpayOrderId = rpOrder.id;
      order.paymentStatus = "created";
      await order.save();
      return res.json({
        order,
        razorpayOrder: {
          id: rpOrder.id,
          amount: rpOrder.amount,
          currency: rpOrder.currency,
          key: process.env.RAZORPAY_KEY_ID
        }
      });
    }

    console.log(`NEW COD ORDER ${order.id} | ${order.customer.name} | ₹${order.totals.grandTotal}`);
    sendOrderEmail(order);
    res.status(201).json({ order });
  } catch (e) {
    console.error(e);
    res.status(500).json({error:"Unable to create order."});
  }
});

app.post("/api/payment/verify", async (req,res) => {
  try {
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({error:"Payment gateway is not configured."});
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) return res.status(400).json({error:"Payment signature verification failed."});

    const order = await Order.findOne({ id: orderId });
    if (!order) return res.status(404).json({error:"Order not found."});

    order.paymentStatus = "paid";
    order.razorpayPaymentId = razorpay_payment_id;
    order.status = "confirmed";
    order.paidAt = new Date();
    await order.save();

    console.log(`PAID ORDER ${order.id} | payment ${razorpay_payment_id}`);
    sendOrderEmail(order);
    res.json({ok:true, order});
  } catch (e) {
    console.error(e);
    res.status(500).json({error:"Payment verification failed."});
  }
});

app.get("/api/orders/:id", async (req,res) => {
  const order = await Order.findOne({ id: req.params.id });
  if (!order) return res.status(404).json({error:"Order not found."});
  res.json(order);
});

app.get("/api/orders", async (req,res) => {
  const phone = String(req.query.phone || "");
  const filter = phone ? { "customer.phone": phone } : {};
  const orders = await Order.find(filter).sort({ placedAt: -1 });
  res.json(orders);
});

app.patch("/api/orders/:id/status", async (req,res) => {
  const allowed = ["placed","confirmed","preparing","ready","outfordelivery","delivered","cancelled"];
  const status = req.body.status;
  if (!allowed.includes(status)) return res.status(400).json({error:"Invalid status."});
  const order = await Order.findOne({ id: req.params.id });
  if (!order) return res.status(404).json({error:"Order not found."});
  order.status = status;
  order.updatedAt = new Date();
  await order.save();
  res.json(order);
});

app.get("/*splat", (req,res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Bunk And Bite running at http://localhost:${PORT}`);
});
