const express = require("express");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();
const axios = require("axios");

const app = express();
const port = process.env.PORT || 3000;
const cors = require("cors");
app.use(cors());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.use(bodyParser.json());

// =======================
// 📌 Notify Me Endpoint
// =======================
app.post("/notify", async (req, res) => {
  const { item, telegram_id } = req.body;

  if (!item || !telegram_id) {
    return res.status(400).json({ error: "Item and telegram_id are required." });
  }

  try {
    const { error } = await supabase.from("notifications").insert([
      {
        item: item.toLowerCase(),
        telegram_id,
      },
    ]);

    if (error) throw error;

    res.status(200).json({ success: true, message: "Notification registered." });
  } catch (err) {
    console.error("❌ /notify error:", err.message);
    res.status(500).json({ error: "Failed to register notification." });
  }
});


// =======================
// 📦 Main Webhook Logic
// =======================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const message = req.body?.message;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const username = message.from?.first_name || "unknown";

  const reply = async (text) => {
    await axios.post(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text,
      }
    );
  };

  try {
    // 1. Show Stock
    if (text.toLowerCase() === "/stock") {
      const { data, error } = await supabase
        .from("stock")
        .select("*")
        .order("timestamp", { ascending: false });

      if (error || !data.length) return reply("📦 No stock data found.");

      const msg = data
        .map((s) => `• ${s.item}: ${s.quantity}${s.unit} (by ${s.added_by})`)
        .join("\n");

      return reply("📦 Current Stock:\n" + msg);
    }

    // 2. Delete Item
    if (text.toLowerCase().startsWith("delete ")) {
      const item = text.split(" ")[1]?.trim().toLowerCase();
      const { error } = await supabase.from("stock").delete().eq("item", item);

      if (error) return reply("❌ Failed to delete item.");
      return reply(`🗑️ Deleted: ${item}`);
    }

    // 3. Update Item
    if (text.toLowerCase().startsWith("update ")) {
      const match = text.match(/^update (\w+):\s*(\d+(?:\.\d+)?)([a-zA-Z]+)$/);
      if (match) {
        const item = match[1].toLowerCase();
        const quantity = parseFloat(match[2]);
        const unit = match[3].toLowerCase();

        const { data: currentData, error: fetchError } = await supabase
          .from("stock")
          .select("quantity, notify_list")
          .eq("item", item)
          .single();

        const wasOutOfStock = !fetchError && currentData?.quantity === 0;

        const { error } = await supabase
          .from("stock")
          .update({ quantity, unit })
          .eq("item", item);

        if (error) return reply("⚠️ Failed to update item.");

        // Notify customers if restocked
        if (wasOutOfStock && quantity > 0 && currentData?.notify_list?.length) {
          for (let tgId of currentData.notify_list) {
            await axios.post(
              `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
              {
                chat_id: tgId,
                text: `✅ Good news! '${item}' is now back in stock: ${quantity}${unit}`,
              }
            );
          }

          // Clear notify_list after notifying
          await supabase
            .from("stock")
            .update({ notify_list: [] })
            .eq("item", item);
        }

        return reply(`✅ Updated ${item} to ${quantity}${unit}`);
      } else {
        return reply("⚠️ Invalid update format. Try: `update onions: 50kg`");
      }
    }

    // 4. Insert Items
    const lines = text.split("\n");
let inserted = [];

for (let line of lines) {
  const match = line.match(/^(\w+):\s*(\d+(?:\.\d+)?)([a-zA-Z]+)$/);
  if (match) {
    const item = match[1].toLowerCase();
    const quantity = parseFloat(match[2]);
    const unit = match[3].toLowerCase();

    const { error } = await supabase.from("stock").insert([
      { item, quantity, unit, added_by: username },
    ]);

    if (!error) {
      inserted.push(`${item}: ${quantity}${unit}`);

      // Check for any notifications for this item
      const { data: notifiers, error: notifFetchError } = await supabase
        .from("notifications")
        .select("telegram_id")
        .eq("item", item);

      if (!notifFetchError && notifiers.length > 0) {
        for (let notify of notifiers) {
          await axios.post(`https://api.telegram.org/bot7883978857:AAFCWQk_bfrXzUeM-CMoF0HUUzkSbkwJpiI/sendMessage`, {
            chat_id: notify.telegram_id,
            text: `🛒 Good News from SmartStock\nThe product you were waiting for – *${item}* – is now **back in stock**! 🎉\nPlease visit the store to purchase it before it runs out again.\n\nThank you for using SmartStock 💚`
,
          });
        }

        // Delete notifications once sent
        await supabase.from("notifications").delete().eq("item", item);
      }
    }
  }
}

    if (inserted.length > 0) {
      await reply(`✅ Added:\n${inserted.join("\n")}`);
    } else {
      await reply("⚠️ No valid item format found.");
    }
  } catch (err) {
    console.error("❌ Error in bot logic:", err.message);
    await reply("⚠️ Internal error occurred.");
  }
});

// =======================
// 🚀 Start Server
// =======================
app.listen(port, () => {
  console.log(`🚀 Bot server is running on port ${port}`);
});
