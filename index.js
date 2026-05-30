const express = require("express");
const session = require("express-session");
const passport = require("passport");
const { Strategy: DiscordStrategy } = require("passport-discord");
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config();

const app = express();

// ================== CONNECT TO DATABASE ==================
if (process.env.MONGO_URI) {
  mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000 // حماية ضد تعليق الخادم إذا كانت الداتابيز غير متصلة
  })
  .then(() => console.log("⚙️ Connected to Bot Database successfully!"))
  .catch(err => console.error("❌ Database connection error:", err));
} else {
  console.log("⚠️ MONGO_URI missing! Dashboard running in offline mode.");
}

// ================== DATABASE SCHEMAS ==================
const GuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  autoReplies: [{ trigger: String, response: String }],
  levelingSystem: {
    enabled: { type: Boolean, default: true },
    xpRate: { type: Number, default: 1 },
    announcementChannel: { type: String, default: null }
  },
  commandShortcuts: [{ commandName: String, shortcut: String }]
});

const Guild = mongoose.models.GuildConfig || mongoose.model("GuildConfig", GuildConfigSchema);

// ================== MIDDLEWARE ==================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "view")); // متوافق مع مجلد view الخاص بك
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================== SESSION ==================
app.use(session({
  secret: process.env.SESSION_SECRET || "gpl_secret_key",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
}));

// ================== PASSPORT (DISCORD OAUTH2) ==================
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
  clientID: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  callbackURL: "https://discord-dashboard-production-bfd2.up.railway.app/auth/discord/callback",
  scope: ["identify", "guilds"]
}, (accessToken, refreshToken, profile, done) => {
  profile.accessToken = accessToken;
  return done(null, profile);
}));

// ================== ROUTES ==================

// 1. الصفحة الرئيسية (Home)
app.get("/", (req, res) => {
  res.render("index", { user: req.user || null });
});

// 2. قائمة سيرفرات لوحة التحكم (Server List)
app.get("/dashboard", async (req, res) => {
  if (!req.user) return res.redirect("/");
  try {
    const adminGuilds = req.user.guilds.filter(guild => (guild.permissions & 0x8) === 0x8);
    res.render("dashboard", {
      user: req.user,
      guilds: adminGuilds
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal Server Error during dashboard loading");
  }
});

// 3. صفحة التحكم بسيرفر معين (Manage Server)
app.get("/dashboard/:guildId", async (req, res) => {
  if (!req.user) return res.redirect("/");
  const { guildId } = req.params;
  
  try {
    const guild = req.user.guilds.find(g => g.id === guildId && (g.permissions & 0x8) === 0x8);
    if (!guild) return res.status(403).send("Access Denied: You do not have Admin permissions.");

    let settings = null;
    
    if (mongoose.connection.readyState === 1) {
      settings = await Guild.findOne({ guildId });
      if (!settings) {
        settings = await Guild.create({ guildId });
      }
    } else {
      // إعدادات افتراضية مؤقتة لعرض اللوحة بدون كراش إذا كانت الداتابيز غير متصلة
      settings = { guildId, autoReplies: [], levelingSystem: { enabled: true, xpRate: 1 }, commandShortcuts: [] };
    }

    res.render("manage", {
      user: req.user,
      guild: guild,
      settings: settings
    });
  } catch (err) {
    console.error("Error loading manage page:", err);
    res.status(500).send("Database connection error. Check MONGO_URI variable.");
  }
});

// 4. حفظ الردود التلقائية الجديدة (Auto Reply Route)
app.post("/dashboard/:guildId/add-reply", async (req, res) => {
  if (!req.user) return res.status(401).send("Unauthorized");
  const { guildId } = req.params;
  const { trigger, response } = req.body;

  try {
    if (mongoose.connection.readyState !== 1) return res.status(500).send("Database is not connected currently.");
    await Guild.findOneAndUpdate(
      { guildId },
      { $push: { autoReplies: { trigger, response } } },
      { upsert: true }
    );
    res.redirect(`/dashboard/${guildId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Database Error");
  }
});

// 5. تحديث إعدادات نظام التلفيل (Leveling Route)
app.post("/dashboard/:guildId/leveling", async (req, res) => {
  if (!req.user) return res.status(401).send("Unauthorized");
  const { guildId } = req.params;
  const { enabled, xpRate } = req.body;

  try {
    if (mongoose.connection.readyState !== 1) return res.status(500).send("Database is not connected currently.");
    await Guild.findOneAndUpdate(
      { guildId },
      { 
        "levelingSystem.enabled": enabled === "true",
        "levelingSystem.xpRate": parseFloat(xpRate) || 1
      },
      { upsert: true }
    );
    res.redirect(`/dashboard/${guildId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating leveling system settings");
  }
});

// 6. إضافة اختصار لأمر (Command Shortcut Route)
app.post("/dashboard/:guildId/shortcut", async (req, res) => {
  if (!req.user) return res.status(401).send("Unauthorized");
  const { guildId } = req.params;
  const { commandName, shortcut } = req.body;

  try {
    if (mongoose.connection.readyState !== 1) return res.status(500).send("Database is not connected currently.");
    await Guild.findOneAndUpdate(
      { guildId },
      { $push: { commandShortcuts: { commandName, shortcut } } },
      { upsert: true }
    );
    res.redirect(`/dashboard/${guildId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error adding command shortcut");
  }
});

// روابط تسجيل الدخول والخروج عبر ديسكورد
app.get("/auth/discord", passport.authenticate("discord"));

app.get("/auth/discord/callback", passport.authenticate("discord", { failureRedirect: "/" }), (req, res) => {
  res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.logout((err) => { res.redirect("/"); });
});

// تشغيل السيرفر والاستماع للمنفذ
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Dashboard is running successfully on port ${PORT}!`);
});
