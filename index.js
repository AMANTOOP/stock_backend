const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Parse incoming Telegram messages
app.use(bodyParser.json());

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const message = req.body?.message;
  if (!message || !message.text) return;

  console.log("Incoming Telegram message:", message);

  const chatId = message.chat.id;
  const text = message.text.trim();
  const username = message.from?.first_name || "unknown";

  const reply = async (text) => {
    await axios.post(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
    });
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
        const item = match[1];
        const quantity = parseFloat(match[2]);
        const unit = match[3].toLowerCase();

        const { error } = await supabase
          .from("stock")
          .update({ quantity, unit })
          .eq("item", item);

        if (error) return reply("⚠️ Failed to update item.");
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

        if (!error) inserted.push(`${item}: ${quantity}${unit}`);
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



app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
