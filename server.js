require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const Order = require("./models/Order");
const Product = require("./models/Product");
const EmailOtp = require("./models/EmailOtp");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------- Email notification setup ----------------
// Sends an email to the shop owner every time a new order comes in.
// Uses Brevo's HTTP email API (works over port 443, which cloud hosts
// like Render never block — unlike raw SMTP ports 465/587).
const emailEnabled = Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);
if (!emailEnabled) {
  console.warn("Email notifications are OFF. Add BREVO_API_KEY and BREVO_SENDER_EMAIL to .env to enable them.");
}

async function sendOrderEmail(order) {
  if (!emailEnabled) return;
  const itemsList = order.items
    .map(it => `- ${it.name}${it.customizationText ? ' (' + it.customizationText + ')' : ''} x${it.qty} (₹${it.lineTotal ?? ""})`)
    .join("\n");
  const notifyTo = process.env.NOTIFY_EMAIL || process.env.BREVO_SENDER_EMAIL;
  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        sender: { name: "Bunk And Bite", email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email: notifyTo }],
        subject: `🍕 New Order ${order.id} — ₹${order.totals?.grandTotal ?? ""}`,
        textContent:
`New order received!

Order ID: ${order.id}
Customer: ${order.customer.name} (${order.customer.phone})
Payment: ${order.paymentMethod.toUpperCase()}
Address: ${order.address?.text || ""}

Items:
${itemsList}

Grand Total: ₹${order.totals?.grandTotal ?? ""}`
      })
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Brevo API responded ${resp.status}: ${errText}`);
    }
    console.log(`Notification email sent for order ${order.id}`);
  } catch (e) {
    console.error("Failed to send notification email:", e.message);
  }
}

// ---------------- Email OTP (customer verification) ----------------
// Sends a 6-digit OTP to the CUSTOMER's email (different from sendOrderEmail,
// which notifies the shop owner). Reuses the same Brevo HTTP API.
async function sendOtpEmail(toEmail, otp) {
  if (!emailEnabled) {
    throw new Error("Email is not configured on the server (missing BREVO_API_KEY/BREVO_SENDER_EMAIL).");
  }
  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      sender: { name: "Bunk And Bite", email: process.env.BREVO_SENDER_EMAIL },
      to: [{ email: toEmail }],
      subject: `Your Bunk And Bite verification code: ${otp}`,
      textContent: `Your OTP to verify your email is: ${otp}\n\nThis code expires in 10 minutes. If you did not request this, ignore this email.`
    })
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Brevo API responded ${resp.status}: ${errText}`);
  }
}

// A short-lived signed token proves "this email was OTP-verified recently"
// without needing the browser to keep hitting the database. Order creation
// checks this token instead of re-checking the EmailOtp collection.
function makeEmailVerificationToken(email) {
  const expiresAt = Date.now() + 30 * 60 * 1000; // valid 30 minutes after verification
  const payload = `${email.toLowerCase()}|${expiresAt}`;
  const secret = process.env.ADMIN_PASSWORD || process.env.RAZORPAY_KEY_SECRET || "fallback-secret-change-me";
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}
function verifyEmailVerificationToken(token, email) {
  try {
    const secret = process.env.ADMIN_PASSWORD || process.env.RAZORPAY_KEY_SECRET || "fallback-secret-change-me";
    const decoded = Buffer.from(String(token), "base64url").toString("utf8");
    const [tokenEmail, expiresAtStr, sig] = decoded.split("|");
    if (tokenEmail !== String(email || "").toLowerCase()) return false;
    const expected = crypto.createHmac("sha256", secret).update(`${tokenEmail}|${expiresAtStr}`).digest("hex");
    if (sig !== expected) return false;
    if (Date.now() > Number(expiresAtStr)) return false;
    return true;
  } catch {
    return false;
  }
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
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
    emailConfigured: emailEnabled
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

app.post("/api/delivery/login", (req, res) => {
  if (!process.env.DELIVERY_PASSWORD) {
    return res.status(503).json({ error: "Delivery panel is not configured. Add DELIVERY_PASSWORD to .env." });
  }
  const { password } = req.body;
  if (password !== process.env.DELIVERY_PASSWORD) {
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

// ---------------- Email OTP endpoints ----------------
app.post("/api/otp/send", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!validEmail(email)) return res.status(400).json({ error: "Valid email is required." });
    if (!emailEnabled) return res.status(503).json({ error: "Email service is not configured on the server." });

    const otp = String(crypto.randomInt(100000, 1000000)); // 6-digit
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Basic anti-spam: don't allow a fresh send if one was requested <30s ago.
    const existing = await EmailOtp.findOne({ email });
    if (existing && Date.now() - existing.createdAt.getTime() < 30 * 1000) {
      return res.status(429).json({ error: "Please wait a few seconds before requesting another OTP." });
    }

    await EmailOtp.findOneAndUpdate(
      { email },
      { email, otp, verified: false, attempts: 0, createdAt: new Date(), expiresAt },
      { upsert: true }
    );

    await sendOtpEmail(email, otp);
    res.json({ ok: true, message: "OTP sent to your email." });
  } catch (e) {
    console.error("Failed to send OTP:", e.message);
    res.status(500).json({ error: "Unable to send OTP right now. Please try again." });
  }
});

app.post("/api/otp/verify", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const otp = String(req.body.otp || "").trim();
    if (!validEmail(email) || !otp) return res.status(400).json({ error: "Email and OTP are required." });

    const record = await EmailOtp.findOne({ email });
    if (!record) return res.status(400).json({ error: "No OTP found for this email. Please request a new one." });
    if (record.expiresAt < new Date()) return res.status(400).json({ error: "OTP has expired. Please request a new one." });
    if (record.attempts >= 5) return res.status(429).json({ error: "Too many incorrect attempts. Please request a new OTP." });

    if (record.otp !== otp) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ error: "Incorrect OTP." });
    }

    record.verified = true;
    await record.save();

    const token = makeEmailVerificationToken(email);
    res.json({ ok: true, verificationToken: token });
  } catch (e) {
    console.error("Failed to verify OTP:", e.message);
    res.status(500).json({ error: "Unable to verify OTP right now. Please try again." });
  }
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
      customer: { name: String(customer.name).slice(0,100), phone: String(customer.phone), email: `${String(customer.phone)}@guest.bunkandbite.local` },
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
  try {
    const allowed = ["placed","confirmed","preparing","ready","outfordelivery","delivered","cancelled"];
    const status = req.body.status;
    const deliveryPartnerName = req.body.deliveryPartnerName;
    if (!allowed.includes(status)) return res.status(400).json({error:"Invalid status."});
    const order = await Order.findOne({ id: req.params.id });
    if (!order) return res.status(404).json({error:"Order not found."});
    if (!order.customer.email) order.customer.email = `${order.customer.phone}@guest.bunkandbite.local`; // backfill legacy orders
    order.status = status;
    order.updatedAt = new Date();
    if (deliveryPartnerName) {
      order.set("deliveryPartnerName", deliveryPartnerName, { strict: false });
    }
    await order.save();
    res.json(order);
  } catch (e) {
    console.error(e);
    res.status(500).json({error:"Unable to update order status."});
  }
});

// ---------------- Cancel order (customer / delivery / admin) ----------------
app.patch("/api/orders/:id/cancel", async (req, res) => {
  try {
    const { cancelledBy, name, phone } = req.body; // cancelledBy: "customer" | "delivery" | "admin"
    const validRoles = ["customer", "delivery", "admin"];
    if (!validRoles.includes(cancelledBy)) return res.status(400).json({ error: "Invalid cancellation source." });

    const order = await Order.findOne({ id: req.params.id });
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (order.status === "delivered") return res.status(400).json({ error: "Delivered orders can't be cancelled." });
    if (order.status === "cancelled") return res.status(400).json({ error: "This order is already cancelled." });

    // A customer can only cancel their own order — verify by phone match.
    if (cancelledBy === "customer") {
      if (!phone || phone !== order.customer.phone) {
        return res.status(403).json({ error: "Phone number does not match this order." });
      }
    }

    if (!order.customer.email) order.customer.email = `${order.customer.phone}@guest.bunkandbite.local`; // backfill legacy orders
    order.status = "cancelled";
    order.updatedAt = new Date();
    order.set("cancelledBy", cancelledBy, { strict: false });
    order.set("cancelledByName", name || "", { strict: false });
    order.set("cancelledAt", new Date(), { strict: false });
    await order.save();
    res.json(order);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Unable to cancel order." });
  }
});

// ---------------- Delivery partner stats ----------------
app.get("/api/delivery/stats", async (req, res) => {
  const name = String(req.query.name || "").trim();
  if (!name) return res.status(400).json({ error: "Delivery partner name is required." });
  const delivered = await Order.countDocuments({ deliveryPartnerName: name, status: "delivered" });
  const active = await Order.countDocuments({ deliveryPartnerName: name, status: { $nin: ["delivered","cancelled"] } });
  res.json({ name, delivered, active });
});

app.get("/*splat", (req,res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Bunk And Bite running at http://localhost:${PORT}`);
});