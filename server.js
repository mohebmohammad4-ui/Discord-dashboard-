const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
require("dotenv").config();

const connectMongo = require("./database/mongo");
// تم تصحيح المسار ليتوافق مع مجلد models بحرف s
const Guild = require("./models/guildconfig");

const app = express();

// ================== MIDDLEWARE ==================
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================== SESSION ==================
app.use(session({
  secret: process.env.SESSION_SECRET || "super-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// ================== PASSPORT ==================
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ["identify", "guilds"]
  },
  (accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken;
    return done(null, profile);
  }
)); // الأقواس هنا مغلقة بشكل رياضي وبرمجي سليم تماماً لمنع خطأ سطر 33

// ================== ROUTES ==================

// Home
app.get("/", (req, res) => {
  res.render("index", { user: req.user });
});

// Dashboard
app.get("/dashboard", (req, res) => {
  if (!req.user) return res.redirect("/");
  res.render("dashboard", {
    user: req.user,
    guild: null
  });
});

// Login
app.get("/auth/discord", passport.authenticate("discord"));

// Callback
app.get("/auth/discord/callback",
  passport.authenticate("discord", { failureRedirect: "/" }),
  (req, res) => {
    res.redirect("/dashboard");
  }
);

// Logout
app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) { 
      console.error(err);
      return res.redirect("/");
    }
    res.redirect("/");
  });
});

// ================== AUTO REPLY SYSTEM ==================
app.post("/add-reply", async (req, res) => {
  const { guildId, trigger, response } = req.body;

  if (!guildId || !trigger || !response) {
    return res.send("Missing data");
  }

  try {
    await Guild.findOneAndUpdate(
      { guildId },
      {
        $push: {
          autoReplies: { trigger, response }
        }
      },
      { upsert: true }
    );
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).send("Database error");
  }
});

// ================== START ==================
connectMongo();

app.listen(process.env.PORT || 3000, () => {
  console.log("Dashboard running successfully!");
});
