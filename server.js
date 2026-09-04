const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Razorpay = require("razorpay");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function readOrders() {
  return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
}
function writeOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}
function nextOrderNumber() {
  const orders = readOrders();
  const d = new Date();
  const prefix = `BB-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
  const today = orders.filter(o => o.id && o.id.startsWith(prefix)).length + 1;
  return `${prefix}-${String(today).padStart(4,"0")}`;
}
function validPhone(phone) {
  return /^[6-9]\d{9}$/.test(String(phone || ""));
}

app.get("/api/health", (req,res) => {
  res.json({
    ok: true,
    paymentConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
  });
});

app.post("/api/orders", async (req,res) => {
  try {
    const { customer, items, totals, address, outlet, paymentMethod } = req.body;
    if (!customer?.name || !validPhone(customer.phone)) return res.status(400).json({error:"Valid customer name and 10-digit mobile number are required."});
    if (!Array.isArray(items) || !items.length) return res.status(400).json({error:"Cart is empty."});
    if (!address?.text) return res.status(400).json({error:"Delivery address is required."});
    if (!outlet?.id) return res.status(400).json({error:"Outlet is required."});

    // IMPORTANT: In a production deployment, calculate prices again from the database here.
    // Never trust totals sent by the browser.
    const order = {
      id: nextOrderNumber(),
      customer: { name: String(customer.name).slice(0,100), phone: String(customer.phone) },
      items,
      totals,
      address,
      outlet,
      paymentMethod: paymentMethod === "cod" ? "cod" : "online",
      paymentStatus: paymentMethod === "cod" ? "pending_cod" : "created",
      status: "placed",
      placedAt: new Date().toISOString(),
      etaMins: 35
    };

    const orders = readOrders();
    orders.unshift(order);
    writeOrders(orders);

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
      writeOrders(orders);
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
    res.status(201).json({ order });
  } catch (e) {
    console.error(e);
    res.status(500).json({error:"Unable to create order."});
  }
});

app.post("/api/payment/verify", (req,res) => {
  try {
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({error:"Payment gateway is not configured."});
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) return res.status(400).json({error:"Payment signature verification failed."});

    const orders = readOrders();
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({error:"Order not found."});

    order.paymentStatus = "paid";
    order.razorpayPaymentId = razorpay_payment_id;
    order.status = "confirmed";
    order.paidAt = new Date().toISOString();
    writeOrders(orders);

    console.log(`PAID ORDER ${order.id} | payment ${razorpay_payment_id}`);
    res.json({ok:true, order});
  } catch (e) {
    console.error(e);
    res.status(500).json({error:"Payment verification failed."});
  }
});

app.get("/api/orders/:id", (req,res) => {
  const order = readOrders().find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({error:"Order not found."});
  res.json(order);
});

app.get("/api/orders", (req,res) => {
  const phone = String(req.query.phone || "");
  let orders = readOrders();
  if (phone) orders = orders.filter(o => o.customer?.phone === phone);
  res.json(orders);
});

app.patch("/api/orders/:id/status", (req,res) => {
  const allowed = ["placed","confirmed","preparing","ready","outfordelivery","delivered","cancelled"];
  const status = req.body.status;
  if (!allowed.includes(status)) return res.status(400).json({error:"Invalid status."});
  const orders = readOrders();
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({error:"Order not found."});
  order.status = status;
  order.updatedAt = new Date().toISOString();
  writeOrders(orders);
  res.json(order);
});

app.get("/*splat", (req,res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Bunk And Bite running at http://localhost:${PORT}`);
});
