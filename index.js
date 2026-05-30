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
    serverSelectionTimeoutMS: 5000 
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
app.set("views", path.join(__dirname, "view")); 
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

app.get("/", (req, res) => {
  res.render("index", { user: req.user || null });
});

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
      settings = { guildId, autoReplies: [], levelingSystem: { enabled: true, xpRate: 1 }, commandShortcuts: [] };
    }

    res.render("manage", {
      user: req.user,
      guild: guild,
      settings: settings
    });
  } catch (err) {
    console.error("Error loading manage page:", err);
    res.status(500).send("Database connection error.");
  }
});

// [تحديث]: إضافة رد تلقائي ومنع التكرار والتنظيف
app.post("/dashboard/:guildId/add-reply", async (req, res) => {
  if (!req.user) return res.status(401).send("Unauthorized");
  const { guildId } = req.params;
  let { trigger, response } = req.body;

  trigger = trigger.trim();
  response = response.trim();

  try {
    if (mongoose.connection.readyState !== 1) return res.status(500).send("Database offline.");
    
    // سحب الإعدادات أولاً لمنع التكرار الحرفي
    const checkConfig = await Guild.findOne({ guildId });
    if(checkConfig && checkConfig.autoReplies.some(r => r.trigger.toLowerCase() === trigger.toLowerCase())) {
        return res.send("<script>alert('هذا الرد التلقائي موجود بالفعل!'); window.location.href='/dashboard/" + guildId + "';</script>");
    }

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

// [ميزة جديدة]: حذف رد تلقائي
app.post("/dashboard/:guildId/delete-reply", async (req, res) => {
  if (!req.user) return res.status(401).send("Unauthorized");
  const { guildId } = req.params;
  const { replyId } = req.body;

  try {
    await Guild.findOneAndUpdate(
      { guildId },
      { $pull: { autoReplies: { _id: replyId } } }
    );
    res.redirect(`/dashboard/${guildId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error deleting reply");
  }
});

app.post("/dashboard/:guildId/leveling", async (req, res) => {
  if (!req.user) return res.status(401).send("Unauthorized");
  const { guildId } = req.params;
  const { enabled, xpRate } = req.body;

  try {
    if (mongoose.connection.readyState !== 1) return res.status(500).send("Database offline.");
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
    res.status(500).send("Error updating leveling system");
  }
});

// [تحديث]: إضافة اختصار مع تنظيف البادئات الخاطئة ومنع التكرار
app.post("/dashboard/:guildId/shortcut", async (req, res) => {
  if (!req.user) return res.status(401).send("Unauthorized");
  const { guildId } = req.params;
  let { commandName, shortcut } = req.body;

  // تنظيف المدخلات وإزالة الـ / لتفادي مشاكل القراءة النصية داخل ديسكورد
  commandName = commandName.trim().replace(/^\//, ''); // يحول /avatar إلى avatar
  shortcut = shortcut.trim().replace(/^\//, '');       // يحول /a إلى a

  try {
    if (mongoose.connection.readyState !== 1) return res.status(500).send("Database offline.");
    
    const checkConfig = await Guild.findOne({ guildId });
    if(checkConfig && checkConfig.commandShortcuts.some(s => s.shortcut.toLowerCase() === shortcut.toLowerCase())) {
         return res.send("<script>alert('هذا الاختصار مستخدم بالفعل لأمر آخر!'); window.location.href='/dashboard/" + guildId + "';</script>");
    }

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

// [ميزة جديدة]: حذف اختصار أمر
app.post("/dashboard/:guildId/delete-shortcut", async (req, res) => {
  if (!req.user) return res.status(401).send("Unauthorized");
  const { guildId } = req.params;
  const { shortcutId } = req.body;

  try {
    await Guild.findOneAndUpdate(
      { guildId },
      { $pull: { commandShortcuts: { _id: shortcutId } } }
    );
    res.redirect(`/dashboard/${guildId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error deleting shortcut");
  }
});

app.get("/auth/discord", passport.authenticate("discord"));

app.get("/auth/discord/callback", passport.authenticate("discord", { failureRedirect: "/" }), (req, res) => {
  res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.logout((err) => { res.redirect("/"); });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Dashboard is running successfully on port ${PORT}!`);
});
