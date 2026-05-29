const mongoose = require("mongoose");

const guildSchema = new mongoose.Schema({

  guildId: {
    type: String,
    required: true,
    unique: true
  },

  autoReplies: [
    {
      trigger: String,
      response: String
    }
  ]

});

module.exports = mongoose.model(
  "GuildConfig",
  guildSchema
);
