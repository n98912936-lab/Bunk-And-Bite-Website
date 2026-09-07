// Run this ONCE to copy your existing menu into MongoDB:
//   node scripts/seedProducts.js
// Safe to run again later — it will skip products that already exist (by id).
require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/Product");

const existingProducts = [
  { id:"pz-001", name:"Classic Cheese Pizza", category:"pizza", desc:"Loaded with melty mozzarella on our signature base.", veg:true, available:true, featured:true, rating:4.4, emoji:"🍕", img:"images/classic-cheese-pizza.jpg", customizable:true, prices:{ small:69, medium:84, large:99 } },
  { id:"pz-002", name:"Onion Pizza", category:"pizza", desc:"Classic base topped generously with fresh onions.", veg:true, available:true, featured:false, rating:4.2, emoji:"🍕", img:"images/onion-pizza.jpg", customizable:true, prices:{ small:89, medium:99, large:119 } },
  { id:"pz-003", name:"Corn Pizza", category:"pizza", desc:"Sweet corn kernels over gooey cheese.", veg:true, available:true, featured:false, rating:4.3, emoji:"🍕", img:"images/corn-pizza.jpg", customizable:true, prices:{ small:89, medium:99, large:119 } },
  { id:"pz-004", name:"Margherita Pizza", category:"pizza", desc:"A timeless classic — tomato, basil and cheese.", veg:true, available:true, featured:true, rating:4.5, emoji:"🍕", img:"images/margherita-pizza.jpg", customizable:true, prices:{ small:99, medium:109, large:129 } },
  { id:"pz-005", name:"Double Cheese Margherita", category:"pizza", desc:"Margherita, but with double the cheesy goodness.", veg:true, available:true, featured:true, rating:4.6, emoji:"🍕", img:"images/double-cheese-margherita.jpg", customizable:true, prices:{ small:119, medium:134, large:149 } },
  { id:"pz-006", name:"Paneer Capsicum Pizza", category:"pizza", desc:"Soft paneer cubes with crunchy capsicum.", veg:true, available:true, featured:false, rating:4.4, emoji:"🍕", img:"images/paneer-capsicum-pizza.jpg", customizable:true, prices:{ small:119, medium:134, large:149 } },
  { id:"pz-007", name:"Spicy Jalapeno Pizza", category:"pizza", desc:"A fiery kick of jalapeños on every bite.", veg:true, available:true, featured:false, rating:4.3, emoji:"🍕", img:"images/spicy-jalapeno-pizza.jpg", customizable:true, prices:{ small:119, medium:134, large:149 } },
  { id:"pz-008", name:"Paneer Onion Capsicum Pizza", category:"pizza", desc:"Triple topping combo of paneer, onion and capsicum.", veg:true, available:true, featured:false, rating:4.4, emoji:"🍕", img:"images/paneer-onion-capsicum-pizza.jpg", customizable:true, prices:{ small:129, medium:144, large:159 } },
  { id:"pz-009", name:"Corn and Onion Pizza", category:"pizza", desc:"Sweet corn meets classic onion.", veg:true, available:true, featured:false, rating:4.2, emoji:"🍕", img:"images/corn-and-onion-pizza.jpg", customizable:true, prices:{ small:128, medium:144, large:159 } },
  { id:"pz-010", name:"Peppy Paneer Pizza", category:"pizza", desc:"Paneer, capsicum and red pepper — bold and cheesy.", veg:true, available:true, featured:true, rating:4.6, emoji:"🍕", img:"images/peppy-paneer-pizza.jpg", customizable:true, prices:{ small:159, medium:179, large:199 } },
  { id:"pz-011", name:"Veg Paradise Pizza", category:"pizza", desc:"A loaded garden of veggies on cheesy base.", veg:true, available:true, featured:false, rating:4.5, emoji:"🍕", img:"images/veg-paradise-pizza.jpg", customizable:true, prices:{ small:159, medium:179, large:199 } },
  { id:"pz-012", name:"Farmhouse Pizza", category:"pizza", desc:"Onion, capsicum, corn, tomato — farm-fresh flavour.", veg:true, available:true, featured:true, rating:4.7, emoji:"🍕", img:"images/farmhouse-pizza.jpg", customizable:true, prices:{ small:199, medium:219, large:249 } },
  { id:"bg-001", name:"Classic Veg Aloo Tikki Burger", category:"burgers", desc:"Crisp aloo tikki patty with fresh lettuce and mayo.", veg:true, available:true, featured:false, rating:4.1, emoji:"🍔", img:"images/classic-veg-aloo-tikki-burger.jpg", customizable:false, price:99 },
  { id:"bg-002", name:"Cheese Veg Aloo Tikki Burger", category:"burgers", desc:"Our classic aloo tikki burger with a melted cheese slice.", veg:true, available:true, featured:true, rating:4.3, emoji:"🍔", img:"images/cheese-veg-aloo-tikki-burger.jpg", customizable:false, price:129 },
  { id:"bg-003", name:"Paneer Aloo Tikki Burger", category:"burgers", desc:"Grilled paneer and aloo tikki patty, loaded with flavour.", veg:true, available:true, featured:false, rating:4.4, emoji:"🍔", img:"images/paneer-aloo-tikki-burger.jpg", customizable:false, price:149 },
  { id:"gb-001", name:"Classic Garlic Bread", category:"garlic-bread", desc:"Toasted bread brushed with garlic butter.", veg:true, available:true, featured:false, rating:4.2, emoji:"🥖", img:"images/classic-garlic-bread.jpg", customizable:false, price:99 },
  { id:"gb-002", name:"Cheese Garlic Bread", category:"garlic-bread", desc:"Garlic bread topped with molten cheese.", veg:true, available:true, featured:true, rating:4.5, emoji:"🥖", img:"images/cheese-garlic-bread.jpg", customizable:false, price:129 },
  { id:"gb-003", name:"Spicy Cheese Garlic Bread", category:"garlic-bread", desc:"Cheese garlic bread with a spicy twist.", veg:true, available:true, featured:false, rating:4.3, emoji:"🥖", img:"images/spicy-cheese-garlic-bread.jpg", customizable:false, price:149 },
  { id:"fr-001", name:"Classic Fries", category:"fries", desc:"Golden, crispy and perfectly salted.", veg:true, available:true, featured:false, rating:4.1, emoji:"🍟", img:"images/classic-fries.jpg", customizable:false, price:79 },
  { id:"fr-002", name:"Peri Peri Fries", category:"fries", desc:"Tossed in tangy peri peri seasoning.", veg:true, available:true, featured:true, rating:4.4, emoji:"🍟", img:"images/peri-peri-fries.jpg", customizable:false, price:99 },
  { id:"fr-003", name:"Cheese Fries", category:"fries", desc:"Loaded with a generous layer of cheese.", veg:true, available:true, featured:false, rating:4.3, emoji:"🍟", img:"images/cheese-fries.jpg", customizable:false, price:129 },
  { id:"sd-001", name:"Veg Nuggets", category:"sides", desc:"Crispy bite-sized veggie nuggets.", veg:true, available:true, featured:false, rating:4.0, emoji:"🍗", customizable:false, price:99 },
  { id:"sd-002", name:"Cheesy Bites", category:"sides", desc:"Bite-sized, cheese-stuffed and golden fried.", veg:true, available:true, featured:false, rating:4.2, emoji:"🍗", customizable:false, price:129 },
  { id:"sd-003", name:"Paneer Poppers", category:"sides", desc:"Crunchy on the outside, soft paneer inside.", veg:true, available:true, featured:false, rating:4.3, emoji:"🍗", customizable:false, price:139 },
  { id:"dr-001", name:"Coke", category:"drinks", desc:"Chilled 300ml serving.", veg:true, available:true, featured:false, rating:4.5, emoji:"🥤", img:"images/coke.jpg", customizable:false, price:50 },
  { id:"dr-002", name:"Pepsi", category:"drinks", desc:"Chilled 300ml serving.", veg:true, available:true, featured:false, rating:4.4, emoji:"🥤", img:"images/pepsi.jpg", customizable:false, price:50 },
  { id:"dr-003", name:"Sprite", category:"drinks", desc:"Chilled 300ml serving.", veg:true, available:true, featured:false, rating:4.3, emoji:"🥤", img:"images/sprite.jpg", customizable:false, price:50 },
  { id:"dr-004", name:"Water Bottle", category:"drinks", desc:"500ml packaged drinking water.", veg:true, available:true, featured:false, rating:4.5, emoji:"💧", img:"images/water-bottle.jpg", customizable:false, price:20 },
  { id:"ds-001", name:"Chocolate Lava Cake", category:"desserts", desc:"Warm cake with a molten chocolate centre.", veg:true, available:true, featured:true, rating:4.7, emoji:"🍰", customizable:false, price:99 },
  { id:"ds-002", name:"Brownie", category:"desserts", desc:"Fudgy, rich and chocolatey.", veg:true, available:true, featured:false, rating:4.5, emoji:"🍫", customizable:false, price:89 },
  { id:"cb-001", name:"Pizza + Coke Combo", category:"combos", desc:"Any medium pizza with a chilled Coke.", veg:true, available:true, featured:true, rating:4.5, emoji:"🎉", img:"images/pizza-coke-combo.jpg", customizable:false, comboPizzaCount:1, price:249 },
  { id:"cb-002", name:"Pizza + Garlic Bread + Coke", category:"combos", desc:"Medium pizza, garlic bread and a Coke.", veg:true, available:true, featured:true, rating:4.6, emoji:"🎉", img:"images/pizza-garlic-bread-coke-combo.jpg", customizable:false, comboPizzaCount:1, price:349 },
  { id:"cb-003", name:"Couple Combo", category:"combos", desc:"2 medium pizzas + garlic bread + 2 drinks.", veg:true, available:true, featured:false, rating:4.6, emoji:"🎉", img:"images/couple-combo.jpg", customizable:false, comboPizzaCount:2, price:499 },
  { id:"cb-004", name:"Family Combo", category:"combos", desc:"2 large pizzas + sides + garlic bread + 4 drinks.", veg:true, available:true, featured:false, rating:4.7, emoji:"🎉", img:"images/family-combo.jpg", customizable:false, comboPizzaCount:2, price:699 }
];

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI missing in .env");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  let added = 0, skipped = 0;
  for (const p of existingProducts) {
    const exists = await Product.findOne({ id: p.id });
    if (exists) { skipped++; continue; }
    await Product.create(p);
    added++;
  }
  console.log(`Done. Added ${added} products, skipped ${skipped} (already existed).`);
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
