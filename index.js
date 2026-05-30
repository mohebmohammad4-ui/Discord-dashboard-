const express = require("express");
const session = require("express-session");
const passport = require("passport");
const { Strategy: DiscordStrategy } = require("passport-discord");
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config();

const app = express();

// ================== CONNECT TO DATABASE ==================
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/tokyo_bot")
  .then(() => console.log("⚙️ Connected to Bot Database successfully!"))
  .catch(err => console.error("❌ Database connection error:", err));

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
const Guild = mongoose.model("GuildConfig", GuildConfigSchema);

// ================== MIDDLEWARE ==================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
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
  // تم تثبيت الرابط هنا مباشرة لحل مشكلة الديسكورد نهائياً
  callbackURL: "https://discord-dashboard-production-bfd2.up.railway.app/auth/discord/callback",
  scope: ["identify", "guilds"]
}, (accessToken, refreshToken, profile, done) => {
  profile.accessToken = accessToken;
  return done(null, profile);
}));

// ================== ROUTES ==================

// 1. الصفحة الرئيسية
app.get("/", (req, res) => {
  res.render("index", { user: req.user || null });
});

// 2. لوحة التحكم (عرض سيرفرات المستخدم وصلاحياته)
app.get("/dashboard", async (req, res) => {
  if (!req.user) return res.redirect("/");
  
  // تصفية السيرفرات ليعرض فقط السيرفرات التي يمتلك فيها المستخدم صلاحية Administrator
  const adminGuilds = req.user.guilds.filter(guild => (guild.permissions & 0x8) === 0x8);

  res.render("dashboard", {
    user: req.user,
    guilds: adminGuilds
  });
});

// 3. رابط إدارة سيرفر معين (الردود، التلفيل، الاختصارات)
app.get("/dashboard/:guildId", async (req, res) => {
  if (!req.user) return res.redirect("/");
  const { guildId } = req.params;
  
  const guild = req.user.guilds.find(g => g.id === guildId && (g.permissions & 0x8) === 0x8);
  if (!guild) return res.status(403).send("غير مسموح لك بالدخول لهذا السيرفر.");

  let settings = await Guild.findOne({ guildId });
  if (!settings) {
    settings = await Guild.create({ guildId });
  }

  res.render("manage", {
    user: req.user,
    guild: guild,
    settings: settings
  });
});

// 4. حفظ الردود التلقائية الجديدة
app.post("/dashboard/:guildId/add-reply", async (req, res) => {
  if (!req.user) return res.status(401).send("غير مصرح");
  const { guildId } = req.params;
  const { trigger, response } = req.body;

  try {
    await Guild.findOneAndUpdate(
      { guildId },
      { $push: { autoReplies: { trigger, response } } },
      { upsert: true }
    );
    res.redirect(`/dashboard/${guildId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("خطأ في قاعدة البيانات
